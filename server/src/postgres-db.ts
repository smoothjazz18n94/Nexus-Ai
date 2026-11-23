import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { ChatTurn, ConversationRow, MessageRow, Mode, Role } from "./types.js";
import type { Repository } from "./db.js";
import type { TelegramQueueItem, TelegramStore, TelegramUserRecord } from "./telegram-store.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS telegram_messages (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
  telegram_update_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_update_id, role)
);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_user_seq ON telegram_messages(telegram_user_id, seq DESC);
CREATE TABLE IF NOT EXISTS telegram_update_queue (
  update_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_telegram_queue_pending ON telegram_update_queue(status, received_at);
CREATE TABLE IF NOT EXISTS telegram_processed_updates (
  update_id BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

interface ConvDb { id: string; title: string; mode: Mode; created_at: string; updated_at: string }
interface MsgDb { id: string; conversation_id: string; role: Role; content: string; created_at: string }

const toConv = (r: ConvDb): ConversationRow => ({
  id: r.id, title: r.title, mode: r.mode, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toMsg = (r: MsgDb): MessageRow => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, createdAt: r.created_at,
});

/** Neon PostgreSQL adapter for the long-running Express server. */
export class PostgresRepository implements Repository, TelegramStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Keep the pool modest for a free Neon compute endpoint.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA);
    await this.ping();
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listConversations(q?: string): Promise<ConversationRow[]> {
    const result = q
      ? await this.pool.query<ConvDb>(
          `SELECT * FROM conversations c
           WHERE strpos(lower(c.title), lower($1)) > 0
              OR EXISTS (
                SELECT 1 FROM messages m
                WHERE m.conversation_id = c.id AND strpos(lower(m.content), lower($1)) > 0
              )
           ORDER BY c.updated_at DESC`,
          [q],
        )
      : await this.pool.query<ConvDb>("SELECT * FROM conversations ORDER BY updated_at DESC");
    return result.rows.map(toConv);
  }

  async createConversation(title: string = "New conversation", mode: Mode = "chat"): Promise<ConversationRow> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const result = await this.pool.query<ConvDb>(
      "INSERT INTO conversations (id,title,mode,created_at,updated_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, title, mode, now, now],
    );
    return toConv(result.rows[0]!);
  }

  async getConversation(id: string): Promise<ConversationRow | undefined> {
    const result = await this.pool.query<ConvDb>("SELECT * FROM conversations WHERE id = $1", [id]);
    return result.rows[0] ? toConv(result.rows[0]) : undefined;
  }

  async renameConversation(id: string, title: string): Promise<ConversationRow | undefined> {
    const result = await this.pool.query<ConvDb>(
      "UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3 RETURNING *",
      [title, new Date().toISOString(), id],
    );
    return result.rows[0] ? toConv(result.rows[0]) : undefined;
  }

  async setMode(id: string, mode: Mode): Promise<void> {
    await this.pool.query("UPDATE conversations SET mode = $1 WHERE id = $2", [mode, id]);
  }

  async touch(id: string): Promise<void> {
    await this.pool.query("UPDATE conversations SET updated_at = $1 WHERE id = $2", [new Date().toISOString(), id]);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM conversations WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listMessages(conversationId: string): Promise<MessageRow[]> {
    const result = await this.pool.query<MsgDb>(
      "SELECT id,conversation_id,role,content,created_at FROM messages WHERE conversation_id = $1 ORDER BY seq ASC",
      [conversationId],
    );
    return result.rows.map(toMsg);
  }

  async addMessage(conversationId: string, role: Role, content: string): Promise<MessageRow> {
    const client = await this.pool.connect();
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      const result = await client.query<MsgDb>(
        "INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id,conversation_id,role,content,created_at",
        [id, conversationId, role, content, now],
      );
      await client.query("UPDATE conversations SET updated_at = $1 WHERE id = $2", [now, conversationId]);
      await client.query("COMMIT");
      return toMsg(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteMessage(id: string): Promise<void> {
    await this.pool.query("DELETE FROM messages WHERE id = $1", [id]);
  }

  async enqueueTelegramUpdate(updateId: string, payload: unknown): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO telegram_update_queue (update_id, payload)
       SELECT $1::bigint, $2::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM telegram_processed_updates WHERE update_id = $1::bigint)
       ON CONFLICT (update_id) DO NOTHING
       RETURNING update_id`,
      [updateId, JSON.stringify(payload)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimTelegramUpdate(): Promise<TelegramQueueItem | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ update_id: string; payload: unknown; attempts: number }>(
        `SELECT update_id::text, payload, attempts
         FROM telegram_update_queue
         WHERE status = 'pending'
            OR (status = 'processing' AND locked_at < NOW() - INTERVAL '3 minutes')
         ORDER BY received_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }
      await client.query(
        `UPDATE telegram_update_queue
         SET status = 'processing', attempts = attempts + 1, locked_at = NOW()
         WHERE update_id = $1::bigint`,
        [row.update_id],
      );
      await client.query("COMMIT");
      return { updateId: row.update_id, payload: row.payload, attempts: row.attempts + 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeTelegramUpdate(updateId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO telegram_processed_updates (update_id) VALUES ($1::bigint) ON CONFLICT DO NOTHING",
        [updateId],
      );
      await client.query("DELETE FROM telegram_update_queue WHERE update_id = $1::bigint", [updateId]);
      await client.query("DELETE FROM telegram_processed_updates WHERE processed_at < NOW() - INTERVAL '30 days'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async retryTelegramUpdate(updateId: string, errorCode: string, maxAttempts: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ update_id: string }>(
        `UPDATE telegram_update_queue
         SET status = 'pending', locked_at = NULL, last_error_code = $2
         WHERE update_id = $1::bigint AND attempts < $3
         RETURNING update_id::text`,
        [updateId, errorCode.slice(0, 80), maxAttempts],
      );
      if (result.rowCount) {
        await client.query("COMMIT");
        return true;
      }
      // Do not retain message payloads indefinitely after the final failed attempt.
      await client.query(
        "INSERT INTO telegram_processed_updates (update_id) VALUES ($1::bigint) ON CONFLICT DO NOTHING",
        [updateId],
      );
      await client.query("DELETE FROM telegram_update_queue WHERE update_id = $1::bigint", [updateId]);
      await client.query("COMMIT");
      return false;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureTelegramUser(user: TelegramUserRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO telegram_users (telegram_user_id, chat_id, username, first_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_user_id) DO UPDATE SET
         chat_id = EXCLUDED.chat_id,
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         updated_at = NOW()`,
      [user.userId, user.chatId, user.username ?? null, user.firstName ?? null],
    );
  }

  async countTelegramMessagesSince(userId: string, seconds: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM telegram_messages
       WHERE telegram_user_id = $1 AND role = 'user'
         AND created_at > NOW() - ($2 * INTERVAL '1 second')`,
      [userId, seconds],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countAllTelegramMessagesSince(seconds: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM telegram_messages
       WHERE role = 'user' AND created_at > NOW() - ($1 * INTERVAL '1 second')`,
      [seconds],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async appendTelegramMessage(userId: string, updateId: string, role: Role, content: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO telegram_messages (telegram_user_id, telegram_update_id, role, content)
       VALUES ($1, $2::bigint, $3, $4)
       ON CONFLICT (telegram_update_id, role) DO NOTHING
       RETURNING seq`,
      [userId, updateId, role, content],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getTelegramHistory(userId: string, limit: number): Promise<ChatTurn[]> {
    const result = await this.pool.query<{ role: Role; content: string }>(
      `SELECT role, content FROM (
         SELECT role, content, seq FROM telegram_messages
         WHERE telegram_user_id = $1
         ORDER BY seq DESC LIMIT $2
       ) recent ORDER BY seq ASC`,
      [userId, Math.max(1, Math.min(50, limit))],
    );
    return result.rows.map((row) => ({ role: row.role, content: row.content }));
  }

  async clearTelegramHistory(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM telegram_messages WHERE telegram_user_id = $1", [userId]);
  }
}

export async function createPostgresRepository(connectionString: string): Promise<PostgresRepository> {
  const repo = new PostgresRepository(connectionString);
  try {
    await repo.initialize();
    return repo;
  } catch (error) {
    await repo.close();
    throw error;
  }
}
