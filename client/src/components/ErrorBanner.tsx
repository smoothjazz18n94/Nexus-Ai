import { useEffect, useState } from "react";
import type { ApiErrorInfo } from "../lib/api";
import { AlertIcon, CloseIcon, RetryIcon } from "./Icons";

/** Retrying will not help for these: fix the cause (key, model, wording) or wait for the quota to reset. */
const NO_RETRY = new Set([
  "not_configured", "provider_auth", "provider_region", "provider_model",
  "provider_blocked", "provider_quota_exhausted", "provider_truncated", "validation", "not_found",
]);

export function ErrorBanner({ error, onRetry, onDismiss }: { error: ApiErrorInfo; onRetry: (() => void) | null; onDismiss: () => void }) {
  // When Gemini says "retry in N seconds", count down and enable Retry only when it's worth trying.
  const [wait, setWait] = useState(error.retryAfterSeconds ?? 0);
  useEffect(() => setWait(error.retryAfterSeconds ?? 0), [error]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  return (
    <div className="banner" role="alert">
      <AlertIcon className="banner-icon" />
      <p>{error.message}{wait > 0 ? ` You can retry in ${wait}s.` : ""}</p>
      {onRetry && !NO_RETRY.has(error.code) && (
        <button type="button" className="btn btn-small" onClick={onRetry} disabled={wait > 0}><RetryIcon /> Retry</button>
      )}
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss error"><CloseIcon width={16} height={16} /></button>
    </div>
  );
}
