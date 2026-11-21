import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";
import { titleFromContent } from "../src/util.js";

describe("buildContext", () => {
  it("keeps the most recent messages that fit the budget", () => {
    const history = [
      { role: "user" as const, content: "a".repeat(50) },
      { role: "assistant" as const, content: "b".repeat(50) },
      { role: "user" as const, content: "c".repeat(50) },
    ];
    const ctx = buildContext(history, 120);
    // "b" + "c" fit (100 chars) but the result must start with a user turn, so "b" is dropped.
    expect(ctx).toEqual([{ role: "user", content: "c".repeat(50) }]);
  });

  it("always keeps the newest message even if it exceeds the budget", () => {
    const ctx = buildContext([{ role: "user", content: "x".repeat(500) }], 10);
    expect(ctx).toHaveLength(1);
  });

  it("merges consecutive same-role turns (e.g. after a failed request)", () => {
    const ctx = buildContext(
      [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ],
      1000,
    );
    expect(ctx).toEqual([{ role: "user", content: "first\n\nsecond" }]);
  });

  it("drops empty messages and does not mutate its input", () => {
    const input = [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "  " }];
    expect(buildContext(input, 100)).toEqual([{ role: "user", content: "hi" }]);
    expect(input).toHaveLength(2);
  });
});

describe("titleFromContent", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(titleFromContent("  hello\n\n world  ")).toBe("hello world");
    const t = titleFromContent("word ".repeat(40));
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t.endsWith("…")).toBe(true);
  });
});
