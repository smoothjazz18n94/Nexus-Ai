import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm runs workspace scripts from inside server/, so we load the .env that lives at the
// repository root explicitly. (Works for both src/ and the compiled dist/ folder.)
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(ROOT_DIR, ".env"), quiet: true });

/** All settings come from environment variables so secrets never live in code. */
export interface Config {
  port: number;
  /** Gemini API key from Google AI Studio. Server-side only; never sent to the browser. */
  geminiApiKey: string | undefined;
  /** True when a key was provided but it is still the placeholder from .env.example. */
  geminiKeyIsPlaceholder: boolean;
  model: string;
  maxOutputTokens: number;
  /** How long we wait for Gemini to send the next piece of the reply before giving up. */
  requestTimeoutMs: number;
  /** Max chat messages per minute per IP. Keep at or below your Gemini free-tier requests-per-minute. */
  chatRateLimitPerMinute: number;
  databasePath: string;
  corsOrigin: string | undefined;
  /** Max characters of past conversation sent to the model (keeps usage and latency bounded). */
  contextCharBudget: number;
  maxMessageChars: number;
  trustProxy: boolean;
}

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** People often copy .env.example and forget to replace the placeholder. Detect that. */
const PLACEHOLDER = /^(your[-_ ]|<|changeme|replace[-_ ]?me)|api[-_ ]?key[-_ ]?here/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawKey = env.GEMINI_API_KEY?.trim();
  const isPlaceholder = !!rawKey && PLACEHOLDER.test(rawKey);
  return {
    port: int(env.PORT, 3001),
    geminiApiKey: rawKey && !isPlaceholder ? rawKey : undefined,
    geminiKeyIsPlaceholder: isPlaceholder,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    maxOutputTokens: int(env.MAX_OUTPUT_TOKENS, 4096),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 30_000),
    chatRateLimitPerMinute: int(env.CHAT_RATE_LIMIT_PER_MINUTE, 8),
    databasePath: resolve(ROOT_DIR, env.DATABASE_PATH?.trim() || "data/nexus.db"),
    corsOrigin: env.CORS_ORIGIN?.trim() || undefined,
    contextCharBudget: int(env.CONTEXT_CHAR_BUDGET, 48_000),
    maxMessageChars: int(env.MAX_MESSAGE_CHARS, 12_000),
    trustProxy: env.TRUST_PROXY === "true",
  };
}
