import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../types";
import { CheckIcon, CloseIcon, PencilIcon, TrashIcon } from "./Icons";

interface Props {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

export function ConversationItem({ conversation, active, onSelect, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const commit = () => {
    const next = title.trim();
    setEditing(false);
    if (next && next !== conversation.title) onRename(next);
    else setTitle(conversation.title);
  };

  if (editing) {
    return (
      <li className="conv editing">
        <input
          ref={input}
          value={title}
          maxLength={120}
          aria-label="Conversation title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setTitle(conversation.title); setEditing(false); }
          }}
        />
      </li>
    );
  }

  if (confirming) {
    return (
      <li className="conv confirming" role="alert">
        <span>Delete this conversation?</span>
        <button type="button" className="icon-btn danger" onClick={onDelete} aria-label="Confirm delete"><CheckIcon width={16} height={16} /></button>
        <button type="button" className="icon-btn" onClick={() => setConfirming(false)} aria-label="Cancel delete"><CloseIcon width={16} height={16} /></button>
      </li>
    );
  }

  return (
    <li className={`conv${active ? " active" : ""}`}>
      <button type="button" className="conv-main" onClick={onSelect} aria-current={active ? "page" : undefined} title={conversation.title}>
        <span className="conv-title">{conversation.title}</span>
      </button>
      <span className="conv-actions">
        <button type="button" className="icon-btn" onClick={() => { setTitle(conversation.title); setEditing(true); }} aria-label={`Rename ${conversation.title}`}><PencilIcon /></button>
        <button type="button" className="icon-btn" onClick={() => setConfirming(true)} aria-label={`Delete ${conversation.title}`}><TrashIcon /></button>
      </span>
    </li>
  );
}
