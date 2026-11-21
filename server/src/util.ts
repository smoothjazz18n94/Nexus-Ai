import { DEFAULT_TITLE } from "./db.js";

/** Make a short sidebar title from the first message. */
export function titleFromContent(content: string, max = 48): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
