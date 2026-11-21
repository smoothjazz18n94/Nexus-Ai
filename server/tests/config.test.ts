import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe defaults and treats a missing key as not configured", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.geminiApiKey).toBeUndefined();
    expect(c.geminiKeyIsPlaceholder).toBe(false);
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(c.requestTimeoutMs).toBe(30_000);
  });

  it("detects the .env.example placeholder instead of sending it to Google", () => {
    for (const placeholder of ["your-gemini-api-key-here", "YOUR_KEY", "<paste here>", "changeme"]) {
      const c = loadConfig({ GEMINI_API_KEY: placeholder } as NodeJS.ProcessEnv);
      expect(c.geminiApiKey).toBeUndefined();
      expect(c.geminiKeyIsPlaceholder).toBe(true);
    }
  });

  it("accepts a real-looking key, a custom model, and ignores bad numbers", () => {
    const c = loadConfig({ GEMINI_API_KEY: " AIzaSyExample ", GEMINI_MODEL: "gemini-3.8-flash", REQUEST_TIMEOUT_MS: "abc" } as NodeJS.ProcessEnv);
    expect(c.geminiApiKey).toBe("AIzaSyExample");
    expect(c.model).toBe("gemini-3.8-flash");
    expect(c.requestTimeoutMs).toBe(30_000);
  });
});
