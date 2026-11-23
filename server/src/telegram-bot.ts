import { buildContext } from "./context.js";
import { systemPromptFor } from "./prompts.js";
import type { LLMProvider } from "./llm.js";
import { toPublicProviderError } from "./errors.js";
import type { TelegramQueueItem, TelegramStore } from "./telegram-store.js";

interface TelegramMessage {
  text?: string;
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  chat?: { id: number; type: string };
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramBotOptions {
  token: string;
  store: TelegramStore;
  provider: LLMProvider | null;
  maxMessageChars: number;
  contextCharBudget: number;
  perUserMessagesPerMinute: number;
}

const HELP_TEXT = [
  "I'm Nexus AI, your Gemini-powered productivity assistant.",
  "",
  "Send me a message to chat with me. I can help explain, summarize, rewrite, brainstorm, and answer questions.",
  "",
  "Commands:",
  "/start — Welcome message",
  "/help — Show this help",
  "/reset — Clear your Telegram conversation memory",
  "",
  "Your Telegram messages are stored separately from the website demo to maintain chat context. Use /reset to clear your saved chat history. Please don't send sensitive information.",
].join("\n");

function parseUpdate(payload: unknown): TelegramUpdate | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return payload as TelegramUpdate;
}

function splitTelegramText(text: string, maxLength = 3900): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts.length ? parts : ["I couldn't produce a text response. Please try again."];
}

export class TelegramBotService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private processing = false;

  constructor(private readonly options: TelegramBotOptions) {}

  start(): void {
    if (this.timer) return;
    console.log("[telegram] webhook worker started");
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 1200);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.options.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      // Never log the request URL: it contains the bot token.
      throw new Error(`Telegram API ${method} failed (${response.status})`);
    }
    return payload.result as T;
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    const parts = splitTelegramText(text);
    for (const [index, part] of parts.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
      await this.callApi("sendMessage", {
        chat_id: chatId,
        text: part,
        link_preview_options: { is_disabled: true },
      });
    }
  }

  private async poll(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const job = await this.options.store.claimTelegramUpdate();
      if (job) await this.processJob(job);
    } catch (error) {
      console.error("[telegram] worker poll failed:", (error as object)?.constructor?.name ?? "unknown");
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: TelegramQueueItem): Promise<void> {
    try {
      await this.handleUpdate(job);
      await this.options.store.completeTelegramUpdate(job.updateId);
    } catch (error) {
      const errorCode = (error as object)?.constructor?.name ?? "unknown";
      console.error("[telegram] update failed:", errorCode);
      const willRetry = await this.options.store.retryTelegramUpdate(job.updateId, errorCode, 3);
      if (!willRetry) {
        const message = parseUpdate(job.payload)?.message;
        if (message?.chat?.type === "private" && Number.isSafeInteger(message.chat.id)) {
          try {
            await this.sendText(String(message.chat.id), "Sorry, I couldn't process that message. Please try again shortly.");
          } catch {
            console.error("[telegram] final error notification could not be delivered");
          }
        }
      }
    }
  }

  private async handleUpdate(job: TelegramQueueItem): Promise<void> {
    const message = parseUpdate(job.payload)?.message;
    if (!message?.chat || !Number.isSafeInteger(message.chat.id)) return;
    const chatId = String(message.chat.id);

    if (message.chat.type !== "private") {
      await this.sendText(chatId, "For privacy, please chat with Nexus AI in a private conversation: https://t.me/Nex_usai_bot");
      return;
    }
    if (!message.from || !Number.isSafeInteger(message.from.id) || message.from.is_bot) return;

    const userId = String(message.from.id);
    await this.options.store.ensureTelegramUser({
      userId,
      chatId,
      ...(message.from.username ? { username: message.from.username } : {}),
      ...(message.from.first_name ? { firstName: message.from.first_name } : {}),
    });

    const text = message.text?.trim() ?? "";
    const command = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    if (command === "start") {
      await this.sendText(chatId, `Welcome to Nexus AI!\n\n${HELP_TEXT}`);
      return;
    }
    if (command === "help") {
      await this.sendText(chatId, HELP_TEXT);
      return;
    }
    if (command === "reset") {
      await this.options.store.clearTelegramHistory(userId);
      await this.sendText(chatId, "Your Nexus AI Telegram conversation memory has been cleared. Send a new message whenever you're ready.");
      return;
    }
    if (text.startsWith("/")) {
      await this.sendText(chatId, "I don't recognise that command. Send /help to see what I can do.");
      return;
    }
    if (!text) {
      await this.sendText(chatId, "I can currently respond to text messages. Please send a text prompt.");
      return;
    }
    if (text.length > this.options.maxMessageChars) {
      await this.sendText(chatId, `That message is too long. Please keep it under ${this.options.maxMessageChars.toLocaleString()} characters.`);
      return;
    }
    if (!this.options.provider) {
      await this.sendText(chatId, "Nexus AI is temporarily unavailable because its AI provider is not configured.");
      return;
    }

    const [recentUserCount, recentGlobalCount] = await Promise.all([
      this.options.store.countTelegramMessagesSince(userId, 60),
      this.options.store.countAllTelegramMessagesSince(60),
    ]);
    if (recentUserCount >= this.options.perUserMessagesPerMinute || recentGlobalCount >= this.options.perUserMessagesPerMinute) {
      await this.sendText(chatId, "You're sending messages too quickly. Please wait a moment and try again.");
      return;
    }

    // update_id + role is unique, so a retried webhook cannot add a duplicate user turn.
    await this.options.store.appendTelegramMessage(userId, job.updateId, "user", text);
    const history = await this.options.store.getTelegramHistory(userId, 24);
    const context = buildContext(history, this.options.contextCharBudget);

    try {
      await this.callApi("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {
      // Typing indicators are best-effort and must not block the answer.
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let answer = "";
    try {
      for await (const chunk of this.options.provider.stream({
        system: systemPromptFor("chat"),
        messages: context,
        signal: controller.signal,
      })) answer += chunk;
    } catch (error) {
      const publicError = toPublicProviderError(error);
      console.error("[telegram] Gemini request failed:", publicError.code);
      await this.sendText(chatId, publicError.message);
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!answer.trim()) {
      await this.sendText(chatId, "I couldn't generate a response this time. Please try again.");
      return;
    }
    await this.sendText(chatId, answer);
    await this.options.store.appendTelegramMessage(userId, job.updateId, "assistant", answer);
  }
}
