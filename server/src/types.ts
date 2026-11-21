export const MODES = ["chat", "summarize", "rewrite", "explain", "brainstorm"] as const;
export type Mode = (typeof MODES)[number];
export type Role = "user" | "assistant";

export interface ConversationRow {
  id: string;
  title: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface ChatTurn {
  role: Role;
  content: string;
}
