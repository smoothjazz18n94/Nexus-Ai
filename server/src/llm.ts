import { FinishReason, GoogleGenAI } from "@google/genai";
import { blockedError, ProviderError, timeoutError, truncatedError } from "./errors.js";
import type { ChatTurn } from "./types.js";

export interface StreamParams {
  system: string;
  messages: ChatTurn[];
  signal: AbortSignal;
}

/**
 * The app only depends on this tiny interface, not on Gemini directly.
 * That makes tests easy (use a fake) and lets you swap providers later.
 */
export interface LLMProvider {
  stream(params: StreamParams): AsyncIterable<string>;
}

/** The few fields of a streamed Gemini chunk that we read. */
export interface StreamChunk {
  text?: string | undefined;
  promptFeedback?: { blockReason?: unknown } | undefined;
  candidates?: { finishReason?: string | undefined }[] | undefined;
}

/** The one SDK method we use. Declared separately so tests can inject a fake. */
export interface GeminiClientLike {
  models: {
    generateContentStream(params: {
      model: string;
      contents: { role: "user" | "model"; parts: { text: string }[] }[];
      config: { systemInstruction: string; maxOutputTokens: number; abortSignal: AbortSignal };
    }): Promise<AsyncIterable<StreamChunk>>;
  };
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Give up if Gemini sends nothing for this long (covers both "no first token" and "stream froze"). */
  stallTimeoutMs: number;
  client?: GeminiClientLike;
}

/** Finish reasons that mean "Gemini stopped because of a content policy", not "the answer is complete". */
const POLICY_STOPS = new Set<string>([
  FinishReason.SAFETY, FinishReason.RECITATION, FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT, FinishReason.SPII, FinishReason.LANGUAGE,
]);

const LENGTH_NOTICE = "\n\n> *This reply reached the length limit and was cut off. Ask me to continue.*";

export function createGeminiProvider(opts: GeminiOptions): LLMProvider {
  const client: GeminiClientLike =
    opts.client ??
    (new GoogleGenAI({
      apiKey: opts.apiKey, // read from the environment on the server; never logged or sent to the browser
      httpOptions: {
        // Hard cap for any single request. Our own stall timeout below is the one users normally hit.
        timeout: 120_000,
        // The SDK retries failed calls up to 5 times by default. On the free tier that silently burns
        // your quota and makes the UI hang, so we disable it. The app's Retry button is explicit instead.
        retryOptions: { attempts: 1 },
      },
    }) as unknown as GeminiClientLike);

  return {
    async *stream({ system, messages, signal }) {
      // `inner` is cancelled either by the user (Stop) or by our stall timer.
      const inner = new AbortController();
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; inner.abort(); }, opts.stallTimeoutMs);
      };
      const onAbort = () => inner.abort();
      if (signal.aborted) inner.abort();
      else signal.addEventListener("abort", onAbort, { once: true });

      let producedText = false;
      let finishReason: string | undefined;
      try {
        arm();
        const stream = await client.models.generateContentStream({
          model: opts.model,
          // Gemini calls the assistant role "model".
          contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          config: { systemInstruction: system, maxOutputTokens: opts.maxTokens, abortSignal: inner.signal },
        });
        for await (const chunk of stream) {
          arm(); // data arrived, so reset the stall timer
          if (chunk.promptFeedback?.blockReason) throw new ProviderError(blockedError());
          const text = chunk.text;
          if (text) { producedText = true; yield text; }
          finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
        }
      } catch (err) {
        if (stalled) throw new ProviderError(timeoutError(Math.round(opts.stallTimeoutMs / 1000)));
        throw err;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }

      if (finishReason === FinishReason.MAX_TOKENS) {
        if (!producedText) throw new ProviderError(truncatedError());
        yield LENGTH_NOTICE; // a visible app notice, so a cut-off reply is never mistaken for a complete one
      } else if (finishReason && POLICY_STOPS.has(finishReason)) {
        throw new ProviderError(blockedError());
      } else if (!producedText && finishReason && finishReason !== FinishReason.STOP) {
        throw new ProviderError(blockedError());
      }
    },
  };
}
