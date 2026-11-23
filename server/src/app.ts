import { createHash, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
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

function safeEqual(actual: string, expected: string): boolean {
  // Hash both values first so timingSafeEqual always receives fixed-length buffers.
  const actualHash = createHash("sha256").update(actual, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function parseBasicCredentials(header: string | undefined): { username: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match?.[1]) return null;

  try {
    const decoded = Buffer.from(match[1], "base64");
    // Reject malformed/non-canonical base64 rather than accepting a partial decode.
    if (decoded.toString("base64").replace(/=+$/, "") !== match[1].replace(/=+$/, "")) return null;
    const value = decoded.toString("utf8");
    const separator = value.indexOf(":");
    if (separator < 1) return null;
    return { username: value.slice(0, separator), password: value.slice(separator + 1) };
  } catch {
    return null;
  }
}

function requireDemoLogin(config: Config): RequestHandler {
  // Authentication is disabled in local development when no credentials are configured.
  // loadConfig() rejects missing credentials when NODE_ENV=production.
  if (!config.appUsername || !config.appPassword) return (_req, _res, next) => next();

  return (req, res, next) => {
    const supplied = parseBasicCredentials(req.get("authorization"));
    const usernameMatches = safeEqual(supplied?.username ?? "", config.appUsername!);
    const passwordMatches = safeEqual(supplied?.password ?? "", config.appPassword!);

    if (supplied && usernameMatches && passwordMatches) return next();

    res.setHeader("WWW-Authenticate", 'Basic realm="Nexus AI Demo", charset="UTF-8"');
    res.setHeader("Cache-Control", "no-store");
    res.status(401).type("text/plain").send("Nexus AI demo login required.");
  };
}

export function createApp({ config, repo, provider }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  // upgradeInsecureRequests is off so the production build also works over plain http://localhost.
  app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "upgrade-insecure-requests": null } } }));
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin }));
  // Small body limit: messages are text, so 64kb is plenty and blocks oversized payloads early.
  app.use(express.json({ limit: "64kb" }));

  // Render health checks use this deliberately low-information endpoint without demo credentials.
  app.get("/healthz", async (_req, res) => {
    try {
      await repo.ping();
      res.status(200).json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  if (config.appUsername && config.appPassword) {
    // Count failed login attempts, but do not penalize correctly authenticated requests.
    app.use(rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: limitedResponse("Too many failed login attempts. Please try again later."),
    }));
    app.use(requireDemoLogin(config));
    // Avoid storing conversation pages or API responses in shared browser/proxy caches.
    app.use((_req, res, next) => {
      res.setHeader("Cache-Control", "private, no-store");
      next();
    });
  }

  // Two layers: a loose limit for everything, and a strict one for the expensive AI endpoint.
  const apiLimiter = rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false,
    message: limitedResponse("Too many requests. Please slow down."),
  });
  const chatLimiter = rateLimit({
    windowMs: 60_000, limit: config.chatRateLimitPerMinute, standardHeaders: "draft-8", legacyHeaders: false,
    message: limitedResponse("You're sending messages too quickly (this protects your Gemini free-tier quota). Wait a few seconds and try again."),
  });

  app.get("/api/health", async (_req, res) => {
    try {
      await repo.ping();
      res.json({ ok: true, database: "connected", provider: "gemini", aiConfigured: provider !== null, model: provider ? config.model : null, maxMessageChars: config.maxMessageChars });
    } catch (error) {
      console.error("[health] database check failed:", (error as object)?.constructor?.name ?? "unknown");
      res.status(503).json({ ok: false, database: "unavailable", aiConfigured: provider !== null });
    }
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
