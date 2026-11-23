import { ApiError } from "@google/genai";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { chunks, fakeProvider, makeApp, parseSse, sseRequest } from "./helpers.js";

const ok = () => fakeProvider(() => chunks("Hello", " world"));

async function newConv(app: any, body: object = {}) {
  const res = await request(app).post("/api/conversations").send(body);
  return res.body.conversation as { id: string; title: string };
}

describe("conversation CRUD", () => {
  it("creates, lists, renames, searches and deletes", async () => {
    const { app } = makeApp(ok().provider);
    const a = await newConv(app, { title: "Quarterly plan" });
    const b = await newConv(app, { title: "Python decorators" });

    const list = await request(app).get("/api/conversations");
    expect(list.body.conversations.map((c: any) => c.id).sort()).toEqual([a.id, b.id].sort());

    const renamed = await request(app).patch(`/api/conversations/${a.id}`).send({ title: "  Roadmap  " });
    expect(renamed.body.conversation.title).toBe("Roadmap");

    const found = await request(app).get("/api/conversations").query({ q: "decor" });
    expect(found.body.conversations).toHaveLength(1);
    expect(found.body.conversations[0].id).toBe(b.id);

    expect((await request(app).delete(`/api/conversations/${a.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/conversations/${a.id}`)).status).toBe(404);
  });

  it("search treats % and _ literally and also searches message text", async () => {
    const { app, repo } = makeApp(ok().provider);
    const a = await newConv(app, { title: "A" });
    await repo.addMessage(a.id, "user", "growth was 100% last year");
    expect((await request(app).get("/api/conversations").query({ q: "100%" })).body.conversations).toHaveLength(1);
    expect((await request(app).get("/api/conversations").query({ q: "%" })).body.conversations).toHaveLength(1);
    expect((await request(app).get("/api/conversations").query({ q: "10_" })).body.conversations).toHaveLength(0);
  });
});

describe("validation and limits", () => {
  it("rejects malformed ids, empty titles, bad modes and oversized bodies", async () => {
    const { app } = makeApp(ok().provider);
    expect((await request(app).get("/api/conversations/not%20an%20id")).status).toBe(400);
    const c = await newConv(app);
    expect((await request(app).patch(`/api/conversations/${c.id}`).send({ title: "   " })).status).toBe(400);
    const badMode = await request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "hi", mode: "hack" });
    expect(badMode.status).toBe(400);
    const huge = await request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "x".repeat(70_000) });
    expect(huge.status).toBe(413);
  });

  it("rejects messages over the configured character limit", async () => {
    const { app } = makeApp(ok().provider, { MAX_MESSAGE_CHARS: "20" });
    const c = await newConv(app);
    const res = await request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "y".repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation");
  });

  it("returns a JSON 404 for unknown API routes and handles bad JSON", async () => {
    const { app } = makeApp(ok().provider);
    expect((await request(app).get("/api/nope")).body.error.code).toBe("not_found");
    const bad = await request(app).post("/api/conversations").set("Content-Type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
  });

  it("rate limits the chat endpoint using CHAT_RATE_LIMIT_PER_MINUTE", async () => {
    const { provider } = ok();
    const { app } = makeApp(provider, { CHAT_RATE_LIMIT_PER_MINUTE: "3" });
    const c = await newConv(app);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: `m${i}` }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("streaming chat", () => {
  it("streams deltas, saves both messages, and titles the conversation", async () => {
    const { provider, calls } = ok();
    const { app } = makeApp(provider);
    const c = await newConv(app);
    const res = await sseRequest(
      request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "Explain closures", mode: "explain" }),
    );
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.body);
    expect(events.filter((e) => e.event === "delta").map((e) => e.data.text).join("")).toBe("Hello world");
    expect(events.at(-1)!.event).toBe("done");
    expect(calls[0]!.system).toContain("Current mode (explain)");

    const saved = await request(app).get(`/api/conversations/${c.id}`);
    expect(saved.body.conversation.title).toBe("Explain closures");
    expect(saved.body.messages.map((m: any) => [m.role, m.content])).toEqual([
      ["user", "Explain closures"],
      ["assistant", "Hello world"],
    ]);
  });

  it("sends earlier messages as context on follow-ups", async () => {
    const { provider, calls } = ok();
    const { app } = makeApp(provider);
    const c = await newConv(app);
    await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "first" }));
    await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "second" }));
    expect(calls[1]!.messages.map((m) => m.content)).toEqual(["first", "Hello world", "second"]);
  });

  it("returns 503 JSON when no API key is configured", async () => {
    const { app } = makeApp(null);
    const c = await newConv(app);
    const res = await request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "hi" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("not_configured");
    expect((await request(app).get("/api/health")).body.aiConfigured).toBe(false);
  });
});

describe("shared demo login", () => {
  const demoCredentials = {
    APP_USERNAME: "portfolio-demo",
    APP_PASSWORD: "a-long-test-password-12345",
  };

  it("protects API routes with a browser Basic Auth challenge", async () => {
    const { app } = makeApp(ok().provider, demoCredentials);
    const denied = await request(app).get("/api/conversations");
    expect(denied.status).toBe(401);
    expect(denied.headers["www-authenticate"]).toContain('Basic realm="Nexus AI Demo"');

    const allowed = await request(app)
      .get("/api/conversations")
      .auth(demoCredentials.APP_USERNAME, demoCredentials.APP_PASSWORD);
    expect(allowed.status).toBe(200);
    expect(allowed.body.conversations).toEqual([]);
  });

  it("keeps the low-information Render health check public but protects detailed health", async () => {
    const { app } = makeApp(ok().provider, demoCredentials);
    const publicHealth = await request(app).get("/healthz");
    expect(publicHealth.status).toBe(200);
    expect(publicHealth.body).toEqual({ ok: true });

    const privateHealth = await request(app).get("/api/health");
    expect(privateHealth.status).toBe(401);
    const authenticatedHealth = await request(app)
      .get("/api/health")
      .auth(demoCredentials.APP_USERNAME, demoCredentials.APP_PASSWORD);
    expect(authenticatedHealth.status).toBe(200);
    expect(authenticatedHealth.body.database).toBe("connected");
  });
});

describe("provider failures and retry", () => {
  const geminiBody = (msg: string) => JSON.stringify({ error: { code: 429, message: msg, status: "RESOURCE_EXHAUSTED" } });

  it("maps per-minute rate limits to a retryable error with a wait time, without leaking details", async () => {
    const { provider } = fakeProvider(async function* () {
      throw new ApiError({ status: 429, message: geminiBody("SECRET internal detail. Please retry in 6.2s.") });
    });
    const { app } = makeApp(provider);
    const c = await newConv(app);
    const res = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "hi" }));
    const err = parseSse(res.body).find((e) => e.event === "error")!.data;
    expect(err).toMatchObject({ code: "provider_rate_limited", retryable: true, retryAfterSeconds: 7 });
    expect(res.body).not.toContain("SECRET");
  });

  it("maps an exhausted daily quota to a non-retryable error that explains the reset", async () => {
    const { provider } = fakeProvider(async function* () {
      throw new ApiError({ status: 429, message: geminiBody("Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier") });
    });
    const { app } = makeApp(provider);
    const c = await newConv(app);
    const res = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "hi" }));
    const err = parseSse(res.body)[0]!.data;
    expect(err).toMatchObject({ code: "provider_quota_exhausted", retryable: false });
    expect(err.message).toMatch(/midnight Pacific/);
  });

  it("maps auth errors and unknown errors, never echoing keys", async () => {
    let mode: "auth" | "boom" = "auth";
    const { provider } = fakeProvider(async function* () {
      if (mode === "auth") throw new ApiError({ status: 400, message: '{"error":{"message":"API key not valid. key=AIzaSyFAKEKEY123"}}' });
      throw new Error("kaboom with AIzaSyFAKEKEY123");
    });
    const { app } = makeApp(provider);
    const c = await newConv(app);
    const a = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "one" }));
    expect(parseSse(a.body)[0]!.data.code).toBe("provider_auth");
    mode = "boom";
    const b = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "two" }));
    expect(parseSse(b.body)[0]!.data.code).toBe("internal");
    expect(a.body + b.body).not.toContain("AIza");
  });

  it("retry (regenerate) re-runs the last user turn and replaces a partial reply", async () => {
    let fail = true;
    const { provider, calls } = fakeProvider(async function* () {
      if (fail) { yield "partial"; throw new Error("network"); }
      yield "complete answer";
    });
    const { app } = makeApp(provider);
    const c = await newConv(app);
    const first = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ content: "question" }));
    expect(parseSse(first.body).some((e) => e.event === "error")).toBe(true);

    fail = false;
    const retry = await sseRequest(request(app).post(`/api/conversations/${c.id}/messages`).send({ regenerate: true }));
    expect(parseSse(retry.body).at(-1)!.event).toBe("done");
    const msgs = (await request(app).get(`/api/conversations/${c.id}`)).body.messages;
    expect(msgs.map((m: any) => [m.role, m.content])).toEqual([["user", "question"], ["assistant", "complete answer"]]);
    expect(calls[1]!.messages).toEqual([{ role: "user", content: "question" }]);
  });

  it("regenerate on an empty conversation is a 400", async () => {
    const { app } = makeApp(ok().provider);
    const c = await newConv(app);
    const res = await request(app).post(`/api/conversations/${c.id}/messages`).send({ regenerate: true });
    expect(res.status).toBe(400);
  });
});
