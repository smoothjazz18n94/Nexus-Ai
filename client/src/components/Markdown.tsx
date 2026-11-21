import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Safety notes (this renders model output, which must be treated as untrusted):
 *  - react-markdown builds React elements and never uses innerHTML. Raw HTML in the text is shown as text
 *    because we deliberately do NOT enable the rehype-raw plugin.
 *  - Its default URL filter drops `javascript:` links.
 *  - Images are replaced with their alt text so a response can't make your browser load tracking URLs.
 *  - Links open in a new tab with rel="noopener noreferrer".
 */
const components: Components = {
  pre({ children }) {
    const child = Children.toArray(children)[0];
    if (isValidElement(child)) {
      const props = child.props as { className?: string; children?: ReactNode };
      const language = /language-([\w-]+)/.exec(props.className ?? "")?.[1];
      return (
        <CodeBlock language={language} code={nodeText(props.children).replace(/\n$/, "")}>
          <code className={props.className}>{props.children}</code>
        </CodeBlock>
      );
    }
    return <pre>{children}</pre>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  img({ alt }) {
    return <span className="md-image-blocked">[image{alt ? `: ${alt}` : ""}]</span>;
  },
  table({ children }) {
    return <div className="table-wrap"><table>{children}</table></div>;
  },
};

const plugins = { remark: [remarkGfm], rehype: [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as never };

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
