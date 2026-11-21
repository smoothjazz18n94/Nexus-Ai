import { ApiError } from "@google/genai";

export type ErrorCode =
  | "validation"
  | "not_found"
  | "rate_limited" // this app's own limiter
  | "provider_rate_limited" // Gemini: too many requests per minute
  | "provider_quota_exhausted" // Gemini: daily free-tier quota used up
  | "provider_auth"
  | "provider_region"
  | "provider_model"
  | "provider_blocked"
  | "provider_timeout"
  | "provider_truncated"
  | "provider_unavailable"
  | "provider_overloaded"
  | "not_configured"
  | "internal";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PublicError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

/** An error we have already classified, safe to show to the user as-is. */
export class ProviderError extends Error {
  constructor(public info: PublicError) {
    super(info.message);
    this.name = "ProviderError";
  }
}

export const timeoutError = (seconds: number): PublicError => ({
  code: "provider_timeout",
  message: `Gemini didn't respond within ${seconds} seconds. Please retry.`,
  retryable: true,
});

export const blockedError = (): PublicError => ({
  code: "provider_blocked",
  message: "Gemini declined to answer this request (its safety filters were triggered). Try rephrasing your message.",
  retryable: false,
});

export const truncatedError = (): PublicError => ({
  code: "provider_truncated",
  message: "The reply used up its length limit before producing any text. Try a shorter request, or raise MAX_OUTPUT_TOKENS.",
  retryable: false,
});

/** Gemini tells us how long to wait in the error text, e.g. "Please retry in 36.9s". */
function parseRetrySeconds(text: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(text);
  return m ? Math.max(1, Math.ceil(Number(m[1]))) : undefined;
}

/**
 * Turn a Gemini HTTP error into a short, friendly message.
 * We read the raw text only to classify it; the raw text is never sent to the user,
 * because provider messages can contain internal details.
 */
export function classifyGeminiError(err: ApiError): PublicError {
  const text = err.message ?? "";
  switch (err.status) {
    case 400:
      if (/api key not valid|API_KEY_INVALID|api key expired|expired/i.test(text)) return authError();
      if (/location is not supported|not available in your (country|region)/i.test(text)) return regionError();
      return {
        code: "internal",
        message: "Gemini rejected this request. Try shortening or rephrasing your message.",
        retryable: false,
      };
    case 401:
    case 403:
      return authError();
    case 404:
      return {
        code: "provider_model",
        message: "Gemini couldn't find the configured model. Check GEMINI_MODEL in your .env file.",
        retryable: false,
      };
    case 408:
    case 504:
      return { code: "provider_timeout", message: "Gemini took too long to respond. Please retry.", retryable: true };
    case 429: {
      // Google reports which quota was hit; the daily one names "PerDay".
      if (/PerDay|per day|daily/i.test(text)) {
        return {
          code: "provider_quota_exhausted",
          message:
            "You've used today's free Gemini quota. It resets at midnight Pacific time. Wait until then, or switch GEMINI_MODEL to another free model.",
          retryable: false,
        };
      }
      const retryAfterSeconds = parseRetrySeconds(text);
      return {
        code: "provider_rate_limited",
        message:
          "You're sending requests faster than the Gemini free tier allows. Wait a moment and retry. If this keeps happening, today's free quota may be used up (it resets at midnight Pacific time).",
        retryable: true,
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      };
    }
    default:
      if (err.status >= 500) {
        return {
          code: "provider_overloaded",
          message: "Gemini is temporarily overloaded or unavailable. Please retry shortly.",
          retryable: true,
        };
      }
      return { code: "internal", message: "Something went wrong while generating a response.", retryable: true };
  }
}

const authError = (): PublicError => ({
  code: "provider_auth",
  message: "Gemini rejected the server's API key. The server owner should check GEMINI_API_KEY in .env, then restart.",
  retryable: false,
});

const regionError = (): PublicError => ({
  code: "provider_region",
  message:
    "Gemini says the free API isn't available from your location. See \"Available regions\" in Google's Gemini API docs.",
  retryable: false,
});

/** Convert anything thrown while calling the provider into a safe public error. */
export function toPublicProviderError(err: unknown): PublicError {
  if (err instanceof HttpError) return { code: err.code, message: err.message, retryable: false };
  if (err instanceof ProviderError) return err.info;
  if (err instanceof ApiError) return classifyGeminiError(err);
  // Node's fetch reports network failures (DNS, offline, connection reset) as TypeError("fetch failed").
  if (err instanceof Error && /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(`${err.message} ${(err.cause as Error | undefined)?.message ?? ""}`)) {
    return {
      code: "provider_unavailable",
      message: "Could not reach Gemini. Check the server's internet connection and retry.",
      retryable: true,
    };
  }
  return { code: "internal", message: "Something went wrong while generating a response.", retryable: true };
}
