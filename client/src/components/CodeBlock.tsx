import type { ReactNode } from "react";
import { useCopy } from "../hooks/useCopy";
import { CheckIcon, CopyIcon } from "./Icons";

export function CodeBlock({ language, code, children }: { language: string | undefined; code: string; children: ReactNode }) {
  const { state, copy } = useCopy();
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{language ?? "text"}</span>
        <button type="button" className="text-btn" onClick={() => void copy(code)} aria-label="Copy code">
          {state === "copied" ? <CheckIcon width={15} height={15} /> : <CopyIcon />}
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
