import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { ROOT_DIR } from "../src/config.js";

interface SqliteConversation {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
}
interface SqliteMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

const backupPath = resolve(ROOT_DIR, process.env.SQLITE_BACKUP_PATH?.trim() || "data/nexus-before-neon.db");
const connectionString = process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED is missing. Run neon env pull or neon deploy, then retry.");
}
if (!existsSync(backupPath)) {
  throw new Error(`SQLite backup not found at ${backupPath}. Do not use the live database; create and verify the backup first.`);
}

const sqlite = new Database(backupPath, { readonly: true, fileMustExist: true });
const pg = new Client({ connectionString, connectionTimeoutMillis: 15_000 });

const schema = `
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

async function main() {
  const integrity = sqlite.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite backup integrity check failed: ${String(integrity)}`);

  const conversations = sqlite
    .prepare("SELECT id,title,mode,created_at,updated_at FROM conversations ORDER BY rowid ASC")
    .all() as SqliteConversation[];
  const messages = sqlite
    .prepare("SELECT id,conversation_id,role,content,created_at FROM messages ORDER BY rowid ASC")
    .all() as SqliteMessage[];

  let connected = false;
  try {
    await pg.connect();
    connected = true;
    await pg.query("BEGIN");
    await pg.query(schema);

    const existing = await pg.query<{ conversations: number; messages: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM conversations) AS conversations,
        (SELECT COUNT(*)::int FROM messages) AS messages`,
    );
    const existingCounts = existing.rows[0]!;
    if (existingCounts.conversations !== 0 || existingCounts.messages !== 0) {
      throw new Error(
        `Neon already contains data (conversations=${existingCounts.conversations}, messages=${existingCounts.messages}). Refusing to overwrite or duplicate records.`,
      );
    }

    for (const row of conversations) {
      await pg.query(
        "INSERT INTO conversations (id,title,mode,created_at,updated_at) VALUES ($1,$2,$3,$4,$5)",
        [row.id, row.title, row.mode, row.created_at, row.updated_at],
      );
    }

    for (const row of messages) {
      await pg.query(
        "INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,$4,$5)",
        [row.id, row.conversation_id, row.role, row.content, row.created_at],
      );
    }

    const orphanCheck = await pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM messages m
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE c.id IS NULL`,
    );
    if (orphanCheck.rows[0]!.n !== 0) throw new Error("Migration produced orphaned messages; transaction will be rolled back.");

    const verified = await pg.query<{ conversations: number; messages: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM conversations) AS conversations,
        (SELECT COUNT(*)::int FROM messages) AS messages`,
    );
    const counts = verified.rows[0]!;
    if (counts.conversations !== conversations.length || counts.messages !== messages.length) {
      throw new Error(
        `Post-migration count mismatch: SQLite had ${conversations.length} conversations/${messages.length} messages; Neon has ${counts.conversations}/${counts.messages}.`,
      );
    }

    await pg.query("COMMIT");

    console.log("SQLite backup integrity: ok");
    console.log(`Migrated conversations: ${counts.conversations}`);
    console.log(`Migrated messages: ${counts.messages}`);
    console.log("Orphaned messages: 0");
    console.log("Neon migration verified successfully.");
  } catch (error) {
    await pg.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (connected) await pg.end();
    sqlite.close();
  }
}

main().catch((error) => {
  console.error("Neon migration failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
