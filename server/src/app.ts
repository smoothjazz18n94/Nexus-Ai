import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Repository } from "./db.js";
import { HttpError } from "./errors.js";
import type { LLMProvider } from "./llm.js";
import { conversationsRouter } from "./routes/conversations.js";
import { messagesRouter } from "./routes/messages.js";

export interface AppDeps {
  config: Config;
  repo: Repository;
  provider: LLMProvider | null;
}

const limitedResponse = (message: string) => ({
  error: { code: "rate_limited", message, retryable: true },
});

export function createApp({ config, repo, provider }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  // upgradeInsecureRequests is off so the production build also works over plain http://localhost.
  app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "upgrade-insecure-requests": null } } }));
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin }));
  // Small body limit: messages are text, so 64kb is plenty and blocks oversized payloads early.
  app.use(express.json({ limit: "64kb" }));

  // Two layers: a loose limit for everything, and a strict one for the expensive AI endpoint.
  const apiLimiter = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false,
    message: limitedResponse("Too many requests. Please slow down."),
  });
  const chatLimiter = rateLimit({
    windowMs: 60_000, limit: config.chatRateLimitPerMinute, standardHeaders: "draft-8", legacyHeaders: false,
    message: limitedResponse("You're sending messages too quickly (this protects your Gemini free-tier quota). Wait a few seconds and try again."),
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, provider: "gemini", aiConfigured: provider !== null, model: provider ? config.model : null, maxMessageChars: config.maxMessageChars });
  });

  app.use("/api", apiLimiter);
  app.post("/api/conversations/:id/messages", chatLimiter);
  app.use("/api/conversations", messagesRouter(repo, provider, config));
  app.use("/api/conversations", conversationsRouter(repo));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not_found", "Route not found")));

  // Serve the built React app in production (single-service deployment).
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*splat}", (_req, res) => res.sendFile(join(clientDist, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return void res.end();
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
      return void res.status(400).json({ error: { code: "validation", message, retryable: false } });
    }
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message, retryable: false } });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 413) return void res.status(413).json({ error: { code: "validation", message: "Request is too large.", retryable: false } });
    if (status === 400) return void res.status(400).json({ error: { code: "validation", message: "Malformed request body.", retryable: false } });
    console.error("[server] unexpected error:", err);
    res.status(500).json({ error: { code: "internal", message: "Internal server error.", retryable: true } });
  };
  app.use(onError);
  return app;
}
