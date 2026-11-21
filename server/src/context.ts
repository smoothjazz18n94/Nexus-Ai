import type { ChatTurn } from "./types.js";

/**
 * Turn stored messages into what we send to the model.
 *
 * Why this exists: models have a limited context window and every token costs money, so we
 * keep the most recent messages that fit in a character budget. We also fix up shape issues:
 * the API expects the conversation to start with a user turn and roles to alternate, but a
 * failed request can leave two user messages in a row.
 */
export function buildContext(history: ChatTurn[], charBudget: number): ChatTurn[] {
  const merged: ChatTurn[] = [];
  for (const turn of history) {
    if (!turn.content.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.content += `\n\n${turn.content}`;
    } else {
      merged.push({ ...turn });
    }
  }

  // Walk backwards, keeping newest messages until the budget is used up.
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = merged.length - 1; i >= 0; i--) {
    const turn = merged[i]!;
    // Always keep the newest message, even if it alone exceeds the budget.
    if (kept.length > 0 && used + turn.content.length > charBudget) break;
    kept.unshift(turn);
    used += turn.content.length;
  }

  while (kept.length > 0 && kept[0]!.role !== "user") kept.shift();
  return kept;
}
