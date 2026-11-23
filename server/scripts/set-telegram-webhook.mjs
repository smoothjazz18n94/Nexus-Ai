import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(rootDir, ".env"), quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const configuredUrl = (process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/$/, "");

if (!token || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the root .env or process environment.");
  process.exit(1);
}
if (!configuredUrl) {
  console.error("Set TELEGRAM_WEBHOOK_URL or RENDER_EXTERNAL_URL before registering the webhook.");
  process.exit(1);
}
if (!/^https:\/\//i.test(configuredUrl)) {
  console.error("The Telegram webhook URL must use HTTPS.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET must be 32-256 characters using letters, numbers, _ or -.");
  process.exit(1);
}

const url = configuredUrl.endsWith("/api/telegram/webhook")
  ? configuredUrl
  : `${configuredUrl}/api/telegram/webhook`;
let response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      max_connections: 5,
      drop_pending_updates: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
} catch {
  console.error("Could not reach the Telegram Bot API. Check your internet connection and try again.");
  process.exit(1);
}

let result;
try {
  result = await response.json();
} catch {
  console.error(`Telegram returned a non-JSON response (HTTP ${response.status}).`);
  process.exit(1);
}
if (!response.ok || !result?.ok) {
  console.error(`Telegram webhook registration failed (HTTP ${response.status}).`);
  console.error(typeof result?.description === "string" ? result.description : "Telegram did not accept the webhook.");
  process.exit(1);
}

console.log("Telegram webhook registered successfully.");
console.log(`Webhook URL: ${url}`);
console.log("Subscribed updates: message");

try {
  const menuResponse = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands: [
      { command: "start", description: "Start Nexus AI" },
      { command: "help", description: "Show available commands" },
      { command: "reset", description: "Clear your chat memory" },
    ] }),
    signal: AbortSignal.timeout(15_000),
  });
  const menuResult = await menuResponse.json();
  if (menuResponse.ok && menuResult?.ok) console.log("Telegram command menu configured.");
  else console.warn("Webhook is active, but Telegram's command menu could not be configured.");
} catch {
  console.warn("Webhook is active, but Telegram's command menu could not be configured.");
}

console.log("The bot token and webhook secret were not printed.");
