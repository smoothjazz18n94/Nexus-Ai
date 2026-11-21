import { useEffect, type RefObject } from "react";
import { MODES } from "../lib/modes";
import type { Mode } from "../types";
import { SendIcon, StopIcon } from "./Icons";

interface Props {
  draft: string;
  onDraft: (v: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  maxChars: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ draft, onDraft, mode, onMode, isStreaming, onSend, onStop, maxChars, inputRef }: Props) {
  const placeholder = MODES.find((m) => m.id === mode)?.placeholder ?? "Message Nexus AI";
  const trimmed = draft.trim();
  const tooLong = draft.length > maxChars;
  const canSend = trimmed.length > 0 && !tooLong && !isStreaming;

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft, inputRef]);

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    onDraft("");
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className="chip" onClick={() => onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="input-row">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {isStreaming ? (
            <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating"><StopIcon /></button>
          ) : (
            <button type="button" className="send" onClick={submit} disabled={!canSend} aria-label="Send message"><SendIcon /></button>
          )}
        </div>
        <div className="hint">
          <span>Enter to send, Shift+Enter for a new line</span>
          {draft.length > maxChars * 0.8 && (
            <span className={tooLong ? "over" : undefined}>{draft.length.toLocaleString()} / {maxChars.toLocaleString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}
