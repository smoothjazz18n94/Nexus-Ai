import { Router, type Response } from "express";
import type { Config } from "../config.js";
import { buildContext } from "../context.js";
import { DEFAULT_TITLE, type Repository } from "../db.js";
import { HttpError, toPublicProviderError } from "../errors.js";
import type { LLMProvider } from "../llm.js";
import { systemPromptFor } from "../prompts.js";
import { titleFromContent } from "../util.js";
import { idParam, sendMessageBody } from "../validation.js";

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/conversations/:id/messages
 *
 * Streams the assistant's reply using Server-Sent Events (SSE): a normal HTTP response that
 * stays open while the server writes small "event:" chunks. Events: delta, done, error.
 */
export function messagesRouter(repo: Repository, provider: LLMProvider | null, config: Config) {
  const r = Router({ mergeParams: true });
  const bodySchema = sendMessageBody(config.maxMessageChars);

  r.post("/:id/messages", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = bodySchema.parse(req.body);
    const conv = await repo.getConversation(id);
    if (!conv) throw new HttpError(404, "not_found", "Conversation not found");
    if (!provider) {
      throw new HttpError(503, "not_configured", "The AI provider is not configured. Set GEMINI_API_KEY in the server's .env file and restart.");
    }

    // 1) Update stored state *before* calling the model.
    if (body.regenerate) {
      const msgs = await repo.listMessages(id);
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") await repo.deleteMessage(last.id);
      const after = await repo.listMessages(id);
      if (after[after.length - 1]?.role !== "user") {
        throw new HttpError(400, "validation", "There is nothing to retry in this conversation.");
      }
    } else {
      const isFirst = (await repo.listMessages(id)).length === 0;
      await repo.addMessage(id, "user", body.content!);
      if (isFirst && conv.title === DEFAULT_TITLE) await repo.renameConversation(id, titleFromContent(body.content!));
    }
    await repo.setMode(id, body.mode);

    const context = buildContext(
      (await repo.listMessages(id)).map((m) => ({ role: m.role, content: m.content })),
      config.contextCharBudget,
    );

    // 2) Open the stream.
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stops nginx-style proxies from buffering the stream
    });
    res.flushHeaders();

    // If the browser disconnects (Stop button / tab closed) we cancel the provider call.
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });

    let text = "";
    try {
      for await (const chunk of provider.stream({ system: systemPromptFor(body.mode), messages: context, signal: controller.signal })) {
        text += chunk;
        if (!controller.signal.aborted) sse(res, "delta", { text: chunk });
      }
      if (controller.signal.aborted) {
        if (text) await repo.addMessage(id, "assistant", text);
        return void res.end();
      }
      if (!text.trim()) throw new Error("Empty response from provider");
      const saved = await repo.addMessage(id, "assistant", text);
      sse(res, "done", { message: saved, conversation: await repo.getConversation(id) });
    } catch (err) {
      if (controller.signal.aborted) {
        if (text) await repo.addMessage(id, "assistant", text);
        return void res.end();
      }
      if (text) await repo.addMessage(id, "assistant", text); // keep partial output; Retry will replace it
      // Log only the error type and HTTP status (never the key or request body).
      console.error("[chat] provider error:", (err as object)?.constructor?.name ?? "unknown", (err as { status?: number })?.status ?? "");
      sse(res, "error", toPublicProviderError(err));
    }
    res.end();
  });

  return r;
}
