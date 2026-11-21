import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Repository } from "./db.js";
import { createGeminiProvider } from "./llm.js";

const config = loadConfig();
const repo = new Repository(config.databasePath);
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

const app = createApp({ config, repo, provider });
const server = app.listen(config.port, () => {
  // Never print the key itself.
  console.log(`Nexus AI server listening on http://localhost:${config.port} (AI ${provider ? `on, Gemini model ${config.model}` : "off"})`);
});

const shutdown = () => { server.close(() => { repo.close(); process.exit(0); }); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
