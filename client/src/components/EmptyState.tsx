import { EXAMPLES, type ExamplePrompt } from "../lib/modes";
import { Mark } from "./Icons";

const LABEL: Record<string, string> = { chat: "Chat", summarize: "Summarize", rewrite: "Rewrite", explain: "Explain", brainstorm: "Brainstorm" };

export function EmptyState({ onPick, aiConfigured }: { onPick: (e: ExamplePrompt) => void; aiConfigured: boolean | null }) {
  return (
    <div className="empty">
      <Mark size={36} />
      <h1>What are you working on?</h1>
      <p className="muted">Chat, or choose a mode below: summarize, rewrite, explain or brainstorm. Start from an example or write your own.</p>
      {aiConfigured === false && (
        <p className="notice" role="status">
          The server has no API key yet, so replies are disabled. Add <code>GEMINI_API_KEY</code> to <code>.env</code> and restart (see the README).
        </p>
      )}
      <ul className="examples">
        {EXAMPLES.map((ex) => (
          <li key={ex.title}>
            <button type="button" onClick={() => onPick(ex)}>
              <span className="ex-title">{ex.title}</span>
              <span className="ex-mode">{LABEL[ex.mode]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
