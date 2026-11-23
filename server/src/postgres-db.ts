import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { ConversationRow, MessageRow, Mode, Role } from "./types.js";
import type { Repository } from "./db.js";

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
export class PostgresRepository implements Repository {
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
