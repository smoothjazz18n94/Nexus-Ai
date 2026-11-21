import { memo, useEffect, useState } from "react";
import { useCopy } from "../hooks/useCopy";
import type { Message } from "../types";
import { CheckIcon, CopyIcon, Mark, RetryIcon } from "./Icons";
import { Markdown } from "./Markdown";

interface Props {
  message: Message;
  isLast?: boolean;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
}

export const MessageView = memo(function MessageView({ message, isLast, canRegenerate, onRegenerate }: Props) {
  const { state, copy } = useCopy();

  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="msg-mark"><Mark size={22} /></div>
      <div className="msg-body">
        <Markdown text={message.content} />
        <div className="msg-actions">
          <button type="button" className="text-btn" onClick={() => void copy(message.content)}>
            {state === "copied" ? <CheckIcon width={15} height={15} /> : <CopyIcon />}
            {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
          </button>
          {isLast && canRegenerate && (
            <button type="button" className="text-btn" onClick={onRegenerate}><RetryIcon /> Regenerate</button>
          )}
        </div>
      </div>
    </div>
  );
});

/** The in-progress reply: dots until the first token arrives, then live Markdown. */
export function StreamingMessage({ text }: { text: string }) {
  // If nothing has arrived after a few seconds, say so instead of looking frozen.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (text) return;
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, [text]);

  return (
    <div className="msg msg-assistant" aria-live="polite" aria-busy="true">
      <div className="msg-mark"><Mark size={22} /></div>
      <div className="msg-body">
        {text ? <Markdown text={text} /> : (
          <>
            <div className="typing" role="status" aria-label="Nexus AI is thinking"><span /><span /><span /></div>
            {slow && <p className="muted small">Still waiting for Gemini. Free-tier models can be slow at busy times.</p>}
          </>
        )}
      </div>
    </div>
  );
}
