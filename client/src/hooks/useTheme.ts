import { useCallback, useEffect, useState } from "react";
import { resolveInitialTheme, THEME_KEY, type Theme } from "../lib/theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* storage blocked */ }
    return resolveInitialTheme(stored, window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
