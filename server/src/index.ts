import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SqliteRepository, type Repository } from "./db.js";
import { createPostgresRepository } from "./postgres-db.js";
import { createGeminiProvider } from "./llm.js";
import { TelegramBotService } from "./telegram-bot.js";
import type { TelegramStore } from "./telegram-store.js";

const config = loadConfig();
// Prefer Neon whenever DATABASE_URL is configured; SQLite remains the local/test fallback.
let repo: Repository;
let telegramStore: TelegramStore | undefined;
if (config.databaseUrl) {
  const postgresRepo = await createPostgresRepository(config.databaseUrl);
  repo = postgresRepo;
  telegramStore = postgresRepo;
} else {
  repo = new SqliteRepository(config.databasePath);
}

const provider = config.geminiApiKey
  ? createGeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.model,
      maxTokens: config.maxOutputTokens,
      stallTimeoutMs: config.requestTimeoutMs,
    })
  : null;

if (config.geminiKeyIsPlaceholder) {
  console.warn("⚠  GEMINI_API_KEY in .env is still the placeholder. Paste your real key from Google AI Studio. AI replies are disabled until then.");
} else if (!provider) {
  console.warn("⚠  GEMINI_API_KEY is not set. The app will run, but AI replies are disabled. See README.");
}

const telegramService = config.telegramBotToken && config.telegramWebhookSecret && telegramStore
  ? new TelegramBotService({
      token: config.telegramBotToken,
      store: telegramStore,
      provider,
      maxMessageChars: config.maxMessageChars,
      contextCharBudget: config.contextCharBudget,
      perUserMessagesPerMinute: config.chatRateLimitPerMinute,
    })
  : undefined;

const app = createApp({
  config,
  repo,
  provider,
  ...(telegramService && config.telegramWebhookSecret
    ? { telegramWebhook: { store: telegramStore!, secret: config.telegramWebhookSecret } }
    : {}),
});
const server = app.listen(config.port, () => {
  console.log(`Nexus AI server listening on http://localhost:${config.port} (Database ${config.databaseUrl ? "Neon PostgreSQL" : "SQLite"}; AI ${provider ? `on, Gemini model ${config.model}` : "off"})`);
  telegramService?.start();
});

const shutdown = () => {
  telegramService?.stop();
  server.close(() => {
    void repo.close().finally(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
