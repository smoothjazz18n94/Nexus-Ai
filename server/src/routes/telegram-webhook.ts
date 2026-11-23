import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { TelegramStore } from "../telegram-store.js";

function safeEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Telegram's secret header is checked before any update is accepted into the durable queue. */
export function telegramWebhookRouter(store: TelegramStore, webhookSecret: string) {
  const router = Router();

  router.post("/", async (req, res) => {
    const supplied = req.get("x-telegram-bot-api-secret-token") ?? "";
    if (!safeEqual(supplied, webhookSecret)) {
      return void res.status(401).json({ ok: false });
    }

    const body = req.body as { update_id?: unknown } | undefined;
    if (!body || typeof body.update_id !== "number" || !Number.isSafeInteger(body.update_id) || body.update_id < 0) {
      return void res.status(400).json({ ok: false });
    }

    try {
      await store.enqueueTelegramUpdate(String(body.update_id), body);
      // Acknowledge quickly; a database-backed worker processes the update asynchronously.
      return void res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[telegram] webhook queue unavailable:", (error as object)?.constructor?.name ?? "unknown");
      // A non-2xx response tells Telegram to retry delivery.
      return void res.status(503).json({ ok: false });
    }
  });

  return router;
}
