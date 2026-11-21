import { Router } from "express";
import type { Repository } from "../db.js";
import { HttpError } from "../errors.js";
import { createConversationBody, idParam, listQuery, renameConversationBody } from "../validation.js";

export function conversationsRouter(repo: Repository) {
  const r = Router();

  const getOr404 = (rawId: string) => {
    const id = idParam.parse(rawId);
    const conv = repo.getConversation(id);
    if (!conv) throw new HttpError(404, "not_found", "Conversation not found");
    return conv;
  };

  r.get("/", (req, res) => {
    const { q } = listQuery.parse(req.query);
    res.json({ conversations: repo.listConversations(q) });
  });

  r.post("/", (req, res) => {
    const body = createConversationBody.parse(req.body ?? {});
    res.status(201).json({ conversation: repo.createConversation(body.title, body.mode) });
  });

  r.get("/:id", (req, res) => {
    const conversation = getOr404(req.params.id);
    res.json({ conversation, messages: repo.listMessages(conversation.id) });
  });

  r.patch("/:id", (req, res) => {
    const conv = getOr404(req.params.id);
    const { title } = renameConversationBody.parse(req.body);
    res.json({ conversation: repo.renameConversation(conv.id, title) });
  });

  r.delete("/:id", (req, res) => {
    const conv = getOr404(req.params.id);
    repo.deleteConversation(conv.id);
    res.status(204).end();
  });

  return r;
}
