import { describe, expect, it } from "vitest";
import { groupConversations } from "../src/lib/groupConversations";
import { resolveInitialTheme } from "../src/lib/theme";
import { SSEParser } from "../src/lib/sse";
import type { Conversation } from "../src/types";

describe("SSEParser", () => {
  it("parses complete events", () => {
    const p = new SSEParser();
    expect(p.feed('event: delta\ndata: {"text":"Hi"}\n\n')).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
  });

  it("buffers events split across network chunks", () => {
    const p = new SSEParser();
    expect(p.feed('event: delta\ndata: {"te')).toEqual([]);
    expect(p.feed('xt":"A"}\n\nevent: do')).toEqual([{ event: "delta", data: '{"text":"A"}' }]);
    expect(p.feed('ne\ndata: {}\n\n')).toEqual([{ event: "done", data: "{}" }]);
  });

  it("handles CRLF, comments and multi-line data", () => {
    const p = new SSEParser();
    expect(p.feed(": keep-alive\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n")).toEqual([{ event: "x", data: "a\nb" }]);
  });
});

describe("groupConversations", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  const at = (daysAgo: number, id: string): Conversation => ({
    id, title: id, mode: "chat", createdAt: "", updatedAt: new Date(2026, 5, 15 - daysAgo, 9).toISOString(),
  });

  it("buckets by recency and omits empty groups", () => {
    const groups = groupConversations([at(0, "a"), at(1, "b"), at(3, "c"), at(30, "d")], now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["a"]], ["Yesterday", ["b"]], ["Previous 7 days", ["c"]], ["Older", ["d"]],
    ]);
    expect(groupConversations([at(0, "a")], now)).toHaveLength(1);
    expect(groupConversations([], now)).toEqual([]);
  });
});

describe("resolveInitialTheme", () => {
  it("prefers a stored choice, otherwise the OS setting", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme("garbage", false)).toBe("light");
  });
});
