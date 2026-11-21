export type Mode = "chat" | "summarize" | "rewrite" | "explain" | "brainstorm";
export interface Conversation { id: string; title: string; mode: Mode; createdAt: string; updatedAt: string }
export interface Message { id: string; role: "user" | "assistant"; content: string; createdAt?: string }
export interface Health { ok: boolean; provider?: string; aiConfigured: boolean; model: string | null; maxMessageChars: number }
