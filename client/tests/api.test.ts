import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, streamMessage } from "../src/lib/api";

function sseResponse(parts: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}
const opts = (onDelta = vi.fn()) => ({ conversationId: "c1", mode: "chat" as const, content: "hi", signal: new AbortController().signal, onDelta });

afterEach(() => vi.unstubAllGlobals());

describe("streamMessage", () => {
  it("emits deltas and resolves with the saved message", async () => {
    const msg = { id: "m1", role: "assistant", content: "Hello" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\n',
      `event: done\ndata: ${JSON.stringify({ message: msg, conversation: { id: "c1" } })}\n\n`,
    ])));
    const onDelta = vi.fn();
    const onStart = vi.fn();
    const result = await streamMessage({ ...opts(onDelta), onStart });
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo"]);
    expect(onStart).toHaveBeenCalledOnce();
    expect(result.message).toEqual(msg);
  });

  it("throws a typed error for an SSE error event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      'event: error\ndata: {"code":"provider_rate_limited","message":"Slow down","retryable":true,"retryAfterSeconds":5}\n\n',
    ])));
    await expect(streamMessage(opts())).rejects.toMatchObject({ code: "provider_rate_limited", retryable: true, retryAfterSeconds: 5 });
  });

  it("throws the server's JSON error for non-2xx responses and does not call onStart", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_configured", message: "No key", retryable: false } }), { status: 503 }),
    ));
    const onStart = vi.fn();
    await expect(streamMessage({ ...opts(), onStart })).rejects.toBeInstanceOf(ApiError);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("reports a retryable network error when the stream ends early or fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(['event: delta\ndata: {"text":"x"}\n\n'])));
    await expect(streamMessage(opts())).rejects.toMatchObject({ code: "network", retryable: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(streamMessage(opts())).rejects.toMatchObject({ code: "network" });
  });

  it("gives up with a retryable timeout error if the server goes silent", async () => {
    // A response whose body never produces data and only ends when the request is aborted.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(new Response(new ReadableStream({
        start(c) { init.signal!.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError"))); },
      }), { status: 200 })),
    ));
    await expect(streamMessage({ ...opts(), idleTimeoutMs: 40 })).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
  });

  it("treats a user Stop as an abort, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(new Response(new ReadableStream({
        start(c) { init.signal!.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError"))); },
      }), { status: 200 })),
    ));
    const ctrl = new AbortController();
    const run = streamMessage({ ...opts(), signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
