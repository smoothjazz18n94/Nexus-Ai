import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SqliteRepository } from "../src/db.js";
import type { LLMProvider, StreamParams } from "../src/llm.js";

export type FakeBehavior = (params: StreamParams) => AsyncIterable<string>;

export function fakeProvider(behavior: FakeBehavior) {
  const calls: StreamParams[] = [];
  const provider: LLMProvider = {
    stream(params) {
      calls.push({ ...params, messages: params.messages.map((m) => ({ ...m })) });
      return behavior(params);
    },
  };
  return { provider, calls };
}

export async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

export function makeApp(provider: LLMProvider | null, overrides: Record<string, string> = {}) {
  // Tests deliberately use in-memory SQLite and never connect to the user's Neon project.
  const config = loadConfig({ DATABASE_PATH: ":memory:", ...overrides } as NodeJS.ProcessEnv);
  const repo = new SqliteRepository(":memory:");
  const app = createApp({ config, repo, provider });
  return { app, repo, config };
}

/** Collect an SSE response body as a string and parse it into events. */
export function sseRequest(req: request.Test) {
  return req
    .buffer(true)
    .parse((res, cb) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => cb(null, data));
    });
}

export function parseSse(body: string): { event: string; data: any }[] {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]!);
      return { event, data };
    });
}
