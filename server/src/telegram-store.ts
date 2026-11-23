import type { ChatTurn, Role } from "./types.js";

export interface TelegramQueueItem {
  updateId: string;
  payload: unknown;
  attempts: number;
}

export interface TelegramUserRecord {
  userId: string;
  chatId: string;
  username?: string;
  firstName?: string;
}

/** PostgreSQL-backed storage used only by the Telegram integration. */
export interface TelegramStore {
  enqueueTelegramUpdate(updateId: string, payload: unknown): Promise<boolean>;
  claimTelegramUpdate(): Promise<TelegramQueueItem | undefined>;
  completeTelegramUpdate(updateId: string): Promise<void>;
  retryTelegramUpdate(updateId: string, errorCode: string, maxAttempts: number): Promise<boolean>;
  ensureTelegramUser(user: TelegramUserRecord): Promise<void>;
  countTelegramMessagesSince(userId: string, seconds: number): Promise<number>;
  countAllTelegramMessagesSince(seconds: number): Promise<number>;
  appendTelegramMessage(userId: string, updateId: string, role: Role, content: string): Promise<boolean>;
  getTelegramHistory(userId: string, limit: number): Promise<ChatTurn[]>;
  clearTelegramHistory(userId: string): Promise<void>;
}
