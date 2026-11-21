import type { Conversation } from "../types";

export interface ConversationGroup { label: string; items: Conversation[] }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Group (already newest-first) conversations into Today / Yesterday / Previous 7 days / Older. */
export function groupConversations(items: Conversation[], now: Date = new Date()): ConversationGroup[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const buckets: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of items) {
    const t = startOfDay(new Date(c.updatedAt));
    const i = t >= today ? 0 : t >= today - day ? 1 : t >= today - 7 * day ? 2 : 3;
    buckets[i]!.items.push(c);
  }
  return buckets.filter((b) => b.items.length > 0);
}
