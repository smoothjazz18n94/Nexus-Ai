import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "../src/components/ErrorBanner";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ErrorBanner", () => {
  it("counts down a rate-limit wait and only then enables Retry", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<ErrorBanner error={{ code: "provider_rate_limited", message: "Slow down.", retryable: true, retryAfterSeconds: 2 }} onRetry={onRetry} onDismiss={() => {}} />);
    const retry = screen.getByRole("button", { name: /retry/i }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("retry in 2s");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("alert").textContent).toContain("retry in 1s");
    act(() => { vi.advanceTimersByTime(1000); });
    expect((screen.getByRole("button", { name: /retry/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides Retry when retrying cannot help (daily quota, bad key, blocked content)", () => {
    for (const code of ["provider_quota_exhausted", "provider_auth", "provider_blocked", "provider_model"]) {
      const { unmount } = render(<ErrorBanner error={{ code, message: "x", retryable: false }} onRetry={() => {}} onDismiss={() => {}} />);
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
      unmount();
    }
  });

  it("shows Retry for transient failures", () => {
    render(<ErrorBanner error={{ code: "provider_overloaded", message: "x", retryable: true }} onRetry={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
