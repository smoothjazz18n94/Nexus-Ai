import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "../src/components/Markdown";

afterEach(cleanup);

describe("Markdown safety", () => {
  it("shows raw HTML as inert text instead of executing it", () => {
    const { container } = render(<Markdown text={'Hi <script>alert(1)</script> <img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("neutralizes javascript: links and hardens normal links", () => {
    const { container } = render(<Markdown text={"[bad](javascript:alert(1)) and [ok](https://example.com)"} />);
    const links = [...container.querySelectorAll("a")];
    expect(links.every((a) => !(a.getAttribute("href") ?? "").toLowerCase().startsWith("javascript:"))).toBe(true);
    const ok = links.find((a) => a.getAttribute("href") === "https://example.com")!;
    expect(ok.getAttribute("target")).toBe("_blank");
    expect(ok.getAttribute("rel")).toContain("noopener");
  });

  it("does not load remote images", () => {
    const { container } = render(<Markdown text={"![tracker](https://evil.example/pixel.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: tracker]");
  });

  it("renders fenced code with a language label and copy button", () => {
    render(<Markdown text={"```ts\nconst x: number = 1;\n```"} />);
    expect(screen.getByText("ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeTruthy();
  });

  it("renders GFM tables and lists", () => {
    const { container } = render(<Markdown text={"| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two"} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
