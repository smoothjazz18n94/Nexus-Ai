import { FinishReason } from "@google/genai";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors.js";
import { createGeminiProvider, type GeminiClientLike, type StreamChunk as Chunk } from "../src/llm.js";

function providerWith(chunks: () => AsyncIterable<Chunk>, stallTimeoutMs = 1000) {
  const calls: any[] = [];
  const client: GeminiClientLike = {
    models: { generateContentStream: async (params) => { calls.push(params); return chunks(); } },
  };
  return { provider: createGeminiProvider({ apiKey: "k", model: "test-model", maxTokens: 100, stallTimeoutMs, client }), calls };
}
async function collect(it: AsyncIterable<string>) { let out = ""; for await (const t of it) out += t; return out; }
const params = (signal = new AbortController().signal) => ({ system: "sys", messages: [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "yo" }, { role: "user" as const, content: "again" }], signal });

describe("Gemini provider", () => {
  it("streams text and sends the system prompt, model, limits and role names Gemini expects", async () => {
    const { provider, calls } = providerWith(async function* () { yield { text: "Hel" }; yield { text: "lo", candidates: [{ finishReason: FinishReason.STOP }] }; });
    expect(await collect(provider.stream(params()))).toBe("Hello");
    expect(calls[0].model).toBe("test-model");
    expect(calls[0].config).toMatchObject({ systemInstruction: "sys", maxOutputTokens: 100 });
    expect(calls[0].contents.map((c: any) => c.role)).toEqual(["user", "model", "user"]);
    expect(calls[0].contents[0].parts[0].text).toBe("hi");
  });

  it("raises a friendly error when the prompt is blocked", async () => {
    const { provider } = providerWith(async function* () { yield { promptFeedback: { blockReason: "SAFETY" } }; });
    await expect(collect(provider.stream(params()))).rejects.toMatchObject({ info: { code: "provider_blocked" } });
  });

  it("raises an error when generation stops for a policy reason with no text", async () => {
    const { provider } = providerWith(async function* () { yield { candidates: [{ finishReason: FinishReason.SAFETY }] }; });
    await expect(collect(provider.stream(params()))).rejects.toBeInstanceOf(ProviderError);
  });

  it("flags a length cut-off visibly, and errors if nothing was produced", async () => {
    const cut = providerWith(async function* () { yield { text: "partial", candidates: [{ finishReason: FinishReason.MAX_TOKENS }] }; });
    expect(await collect(cut.provider.stream(params()))).toMatch(/^partial[\s\S]*cut off/);
    const empty = providerWith(async function* () { yield { candidates: [{ finishReason: FinishReason.MAX_TOKENS }] }; });
    await expect(collect(empty.provider.stream(params()))).rejects.toMatchObject({ info: { code: "provider_truncated" } });
  });

  it("times out when Gemini stops sending data, and cancels the underlying request", async () => {
    let sawAbort = false;
    const client: GeminiClientLike = {
      models: {
        generateContentStream: async ({ config }) => (async function* () {
          yield { text: "first" };
          await new Promise<void>((_, reject) => config.abortSignal.addEventListener("abort", () => { sawAbort = true; reject(new Error("aborted")); }));
        })(),
      },
    };
    const provider = createGeminiProvider({ apiKey: "k", model: "m", maxTokens: 10, stallTimeoutMs: 50, client });
    await expect(collect(provider.stream(params()))).rejects.toMatchObject({ info: { code: "provider_timeout", retryable: true } });
    expect(sawAbort).toBe(true);
  });

  it("times out while waiting for the first token", async () => {
    const client: GeminiClientLike = {
      models: { generateContentStream: ({ config }) => new Promise((_, reject) => config.abortSignal.addEventListener("abort", () => reject(new Error("aborted")))) },
    };
    const provider = createGeminiProvider({ apiKey: "k", model: "m", maxTokens: 10, stallTimeoutMs: 50, client });
    await expect(collect(provider.stream(params()))).rejects.toMatchObject({ info: { code: "provider_timeout" } });
  });

  it("propagates a user cancellation (Stop) to the request without reporting a timeout", async () => {
    const ctrl = new AbortController();
    let sawAbort = false;
    const client: GeminiClientLike = {
      models: {
        generateContentStream: async ({ config }) => (async function* () {
          yield { text: "x" };
          await new Promise<void>((_, reject) => config.abortSignal.addEventListener("abort", () => { sawAbort = true; reject(new Error("aborted")); }));
        })(),
      },
    };
    const provider = createGeminiProvider({ apiKey: "k", model: "m", maxTokens: 10, stallTimeoutMs: 5000, client });
    const run = collect(provider.stream(params(ctrl.signal)));
    setTimeout(() => ctrl.abort(), 30);
    await expect(run).rejects.not.toBeInstanceOf(ProviderError);
    expect(sawAbort).toBe(true);
  });
});
