import { z } from "zod";
import { MODES } from "./types.js";

export const idParam = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid id");

export const createConversationBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(MODES).optional(),
});

export const renameConversationBody = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(120),
});

export function sendMessageBody(maxChars: number) {
  return z
    .object({
      content: z.string().trim().min(1).max(maxChars).optional(),
      mode: z.enum(MODES).default("chat"),
      /** Re-run the last turn (used for retry) instead of adding a new user message. */
      regenerate: z.boolean().default(false),
    })
    .refine((b) => b.regenerate || b.content !== undefined, {
      message: "content is required unless regenerate is true",
      path: ["content"],
    });
}

export const listQuery = z.object({ q: z.string().trim().max(100).optional() });
