import { useCallback, useEffect, useRef, useState } from "react";

/** Copy text to the clipboard and expose a short-lived "copied" flag for UI feedback. */
export function useCopy(resetMs = 1600) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), resetMs);
  }, [resetMs]);

  return { state, copy };
}
