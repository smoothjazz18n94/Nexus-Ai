import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { toPublicProviderError } from "../src/errors.js";

const api = (status: number, message = "") => toPublicProviderError(new ApiError({ status, message }));

describe("Gemini error classification", () => {
  it.each([
    [401, "", "provider_auth", false],
    [403, "", "provider_auth", false],
    [400, "API key not valid. Please pass a valid API key.", "provider_auth", false],
    [400, "User location is not supported for the API use.", "provider_region", false],
    [400, "something else", "internal", false],
    [404, "models/xyz is not found", "provider_model", false],
    [504, "", "provider_timeout", true],
    [500, "", "provider_overloaded", true],
    [503, "The model is overloaded", "provider_overloaded", true],
    [429, "limit: PerMinute", "provider_rate_limited", true],
    [429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "provider_quota_exhausted", false],
  ])("status %i (%s) -> %s", (status, message, code, retryable) => {
    expect(api(status, message)).toMatchObject({ code, retryable });
  });

  it("reads the wait time from RetryInfo or the message text", () => {
    expect(api(429, '{"retryDelay":"37s"}').retryAfterSeconds).toBe(37);
    expect(api(429, "Please retry in 36.9s.").retryAfterSeconds).toBe(37);
    expect(api(429, "no hint").retryAfterSeconds).toBeUndefined();
  });

  it("classifies network failures as retryable and unknown errors as internal", () => {
    expect(toPublicProviderError(new TypeError("fetch failed"))).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(toPublicProviderError(new Error("weird"))).toMatchObject({ code: "internal" });
  });
});
