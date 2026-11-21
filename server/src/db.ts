import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationRow, MessageRow, Mode, Role } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
`;

export const DEFAULT_TITLE = "New conversation";

interface ConvDb { id: string; title: string; mode: Mode; created_at: string; updated_at: string }
interface MsgDb { id: string; conversation_id: string; role: Role; content: string; created_at: string; seq: number }

const toConv = (r: ConvDb): ConversationRow => ({
  id: r.id, title: r.title, mode: r.mode, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toMsg = (r: MsgDb): MessageRow => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, createdAt: r.created_at,
});

/** Escape LIKE wildcards so a search for "100%" matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The only place that talks to SQLite. All queries use bound parameters (the `?`),
 * which is what prevents SQL injection.
 */
export class Repository {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  listConversations(q?: string): ConversationRow[] {
    if (!q) {
      return (this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as ConvDb[]).map(toConv);
    }
    const like = `%${escapeLike(q)}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations c
         WHERE c.title LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\')
         ORDER BY c.updated_at DESC`,
      )
      .all(like, like) as ConvDb[];
    return rows.map(toConv);
  }

  createConversation(title: string = DEFAULT_TITLE, mode: Mode = "chat"): ConversationRow {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare("INSERT INTO conversations (id,title,mode,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, title, mode, now, now);
    return this.getConversation(id)!;
  }

  getConversation(id: string): ConversationRow | undefined {
    const r = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConvDb | undefined;
    return r && toConv(r);
  }

  renameConversation(id: string, title: string): ConversationRow | undefined {
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, new Date().toISOString(), id);
    return this.getConversation(id);
  }

  setMode(id: string, mode: Mode) {
    this.db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(mode, id);
  }

  touch(id: string) {
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  deleteConversation(id: string): boolean {
    return this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
  }

  listMessages(conversationId: string): MessageRow[] {
    // rowid preserves insertion order even if two messages share a timestamp.
    const rows = this.db
      .prepare("SELECT *, rowid AS seq FROM messages WHERE conversation_id = ? ORDER BY seq ASC")
      .all(conversationId) as MsgDb[];
    return rows.map(toMsg);
  }

  addMessage(conversationId: string, role: Role, content: string): MessageRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)").run(id, conversationId, role, content, now);
    this.touch(conversationId);
    return { id, conversationId, role, content, createdAt: now };
  }

  deleteMessage(id: string) {
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }
}
