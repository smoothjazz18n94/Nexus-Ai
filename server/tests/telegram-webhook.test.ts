import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SqliteRepository } from "../src/db.js";
import { telegramWebhookRouter } from "../src/routes/telegram-webhook.js";
import type { TelegramStore } from "../src/telegram-store.js";

const SECRET = "test-webhook-secret-which-is-long-enough-123";

function makeStore() {
  const enqueueTelegramUpdate = vi.fn(async () => true);
  const store = { enqueueTelegramUpdate } as unknown as TelegramStore;
  return { store, enqueueTelegramUpdate };
}

describe("Telegram webhook router", () => {
  function makeWebhook() {
    const { store, enqueueTelegramUpdate } = makeStore();
    const app = express();
    app.use(express.json());
    app.use("/api/telegram/webhook", telegramWebhookRouter(store, SECRET));
    return { app, enqueueTelegramUpdate };
  }

  it("rejects requests without the Telegram secret header", async () => {
    const { app, enqueueTelegramUpdate } = makeWebhook();
    const response = await request(app).post("/api/telegram/webhook").send({ update_id: 1 });
    expect(response.status).toBe(401);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed updates", async () => {
    const { app, enqueueTelegramUpdate } = makeWebhook();
    const response = await request(app)
      .post("/api/telegram/webhook")
      .set("x-telegram-bot-api-secret-token", SECRET)
      .send({ message: { text: "hello" } });
    expect(response.status).toBe(400);
    expect(enqueueTelegramUpdate).not.toHaveBeenCalled();
  });

  it("queues authenticated Telegram updates", async () => {
    const { app, enqueueTelegramUpdate } = makeWebhook();
    const payload = { update_id: 123, message: { text: "hello" } };
    const response = await request(app)
      .post("/api/telegram/webhook")
      .set("x-telegram-bot-api-secret-token", SECRET)
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(enqueueTelegramUpdate).toHaveBeenCalledWith("123", payload);
  });

  it("places the Telegram webhook before the website's shared Basic Auth", async () => {
    const repo = new SqliteRepository(":memory:");
    const config = loadConfig({
      DATABASE_PATH: ":memory:",
      APP_USERNAME: "demo",
      APP_PASSWORD: "a-secure-test-password-123",
    } as NodeJS.ProcessEnv);
    const { store } = makeStore();
    const app = createApp({ config, repo, provider: null, telegramWebhook: { store, secret: SECRET } });
    try {
      const webhook = await request(app)
        .post("/api/telegram/webhook")
        .set("x-telegram-bot-api-secret-token", SECRET)
        .send({ update_id: 7 });
      expect(webhook.status).toBe(200);
      const websiteApi = await request(app).get("/api/conversations");
      expect(websiteApi.status).toBe(401);
    } finally {
      await repo.close();
    }
  });
});
