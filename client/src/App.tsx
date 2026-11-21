import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { ErrorBanner } from "./components/ErrorBanner";
import { MoonIcon, SidebarIcon, SunIcon } from "./components/Icons";
import { MessageView, StreamingMessage } from "./components/MessageView";
import { Sidebar } from "./components/Sidebar";
import { useTheme } from "./hooks/useTheme";
import { useWorkspace } from "./hooks/useWorkspace";
import type { ExamplePrompt } from "./lib/modes";

const isDesktop = () => window.matchMedia("(min-width: 800px)").matches;

export default function App() {
  const ws = useWorkspace();
  const { theme, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const closeOnMobile = useCallback(() => { if (!isDesktop()) setSidebarOpen(false); }, []);

  // Keep the view pinned to the newest text, unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [ws.messages, ws.streamingText, ws.error]);
  useEffect(() => { stick.current = true; }, [ws.activeId]);

  const title = ws.conversations.find((c) => c.id === ws.activeId)?.title ?? "New conversation";
  const empty = ws.messages.length === 0 && !ws.isStreaming && !ws.loadingMessages;
  const pickExample = (ex: ExamplePrompt) => { ws.setMode(ex.mode); setDraft(ex.prompt); inputRef.current?.focus(); };
  const lastIndex = ws.messages.length - 1;

  return (
    <div className="app" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <aside className="sidebar" inert={!sidebarOpen} aria-label="Sidebar">
        <Sidebar
          conversations={ws.conversations}
          activeId={ws.activeId}
          search={ws.search}
          onSearch={ws.setSearch}
          onNew={() => { ws.newChat(); closeOnMobile(); inputRef.current?.focus(); }}
          onSelect={(id) => { void ws.select(id); closeOnMobile(); }}
          onRename={(id, t) => void ws.rename(id, t)}
          onDelete={(id) => void ws.remove(id)}
        />
      </aside>
      <div className="backdrop" onClick={() => setSidebarOpen(false)} aria-hidden />

      <main className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => setSidebarOpen((o) => !o)} aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"} aria-expanded={sidebarOpen}>
            <SidebarIcon />
          </button>
          <h1 className="topbar-title">{title}</h1>
          <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </header>

        <div
          className="scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="thread">
            {empty ? (
              <EmptyState onPick={pickExample} aiConfigured={ws.health ? ws.health.aiConfigured : null} />
            ) : (
              <>
                {ws.loadingMessages && <p className="muted small" role="status">Loading conversation…</p>}
                {ws.messages.map((m, i) => (
                  <MessageView key={m.id} message={m} isLast={i === lastIndex} canRegenerate={!ws.isStreaming && !ws.error} onRegenerate={ws.regenerate} />
                ))}
                {ws.isStreaming && <StreamingMessage text={ws.streamingText ?? ""} />}
              </>
            )}
            {ws.error && <ErrorBanner error={ws.error} onRetry={ws.canRetry ? ws.retry : null} onDismiss={ws.dismissError} />}
          </div>
        </div>

        <Composer
          draft={draft}
          onDraft={setDraft}
          mode={ws.mode}
          onMode={ws.setMode}
          isStreaming={ws.isStreaming}
          onSend={(t) => { stick.current = true; void ws.send(t); }}
          onStop={ws.stop}
          maxChars={ws.health?.maxMessageChars ?? 12000}
          inputRef={inputRef}
        />
      </main>
    </div>
  );
}
