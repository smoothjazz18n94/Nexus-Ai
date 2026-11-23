import { Router } from "express";
import type { Repository } from "../db.js";
import { HttpError } from "../errors.js";
import { createConversationBody, idParam, listQuery, renameConversationBody } from "../validation.js";

export function conversationsRouter(repo: Repository) {
  const r = Router();

  const getOr404 = async (rawId: string) => {
    const id = idParam.parse(rawId);
    const conv = await repo.getConversation(id);
    if (!conv) throw new HttpError(404, "not_found", "Conversation not found");
    return conv;
  };

  r.get("/", async (req, res) => {
    const { q } = listQuery.parse(req.query);
    res.json({ conversations: await repo.listConversations(q) });
  });

  r.post("/", async (req, res) => {
    const body = createConversationBody.parse(req.body ?? {});
    res.status(201).json({ conversation: await repo.createConversation(body.title, body.mode) });
  });

  r.get("/:id", async (req, res) => {
    const conversation = await getOr404(req.params.id);
    res.json({ conversation, messages: await repo.listMessages(conversation.id) });
  });

  r.patch("/:id", async (req, res) => {
    const conv = await getOr404(req.params.id);
    const { title } = renameConversationBody.parse(req.body);
    res.json({ conversation: await repo.renameConversation(conv.id, title) });
  });

  r.delete("/:id", async (req, res) => {
    const conv = await getOr404(req.params.id);
    await repo.deleteConversation(conv.id);
    res.status(204).end();
  });

  return r;
}
