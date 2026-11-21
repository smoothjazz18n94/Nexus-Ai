import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, streamMessage, type ApiErrorInfo } from "../lib/api";
import type { Conversation, Health, Message, Mode } from "../types";

const toInfo = (e: unknown): ApiErrorInfo =>
  e instanceof ApiError ? e : { code: "internal", message: "Something went wrong. Please try again.", retryable: true };

type Retry = { regenerate: true } | { content: string };

/**
 * All app state and server interaction lives here, so components stay simple and presentational.
 * Key idea: `activeIdRef` always holds the conversation the user is looking at, so a slow
 * response for a conversation they've already left never writes into the wrong screen.
 */
export function useWorkspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<Retry | null>(null);
  const searchRef = useRef("");
  const listRequest = useRef(0);

  const loadList = useCallback(async (q: string) => {
    const n = ++listRequest.current;
    try {
      const list = await api.listConversations(q || undefined);
      if (n === listRequest.current) setConversations(list);
    } catch (e) {
      if (n === listRequest.current) setError(toInfo(e));
    }
  }, []);

  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);

  // Debounce search so we don't query on every keystroke.
  useEffect(() => {
    searchRef.current = search;
    const t = window.setTimeout(() => void loadList(search.trim()), search ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [search, loadList]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingText(null);
  }, []);

  const newChat = useCallback(() => {
    activeIdRef.current = null;
    cancelStream();
    setActiveId(null);
    setMessages([]);
    setMode("chat");
    setError(null);
    retryRef.current = null;
  }, [cancelStream]);

  const select = useCallback(async (id: string) => {
    if (id === activeIdRef.current) return;
    activeIdRef.current = id;
    cancelStream();
    setActiveId(id);
    setError(null);
    retryRef.current = null;
    setMessages([]);
    setLoadingMessages(true);
    try {
      const data = await api.getConversation(id);
      if (activeIdRef.current !== id) return;
      setMessages(data.messages);
      setMode(data.conversation.mode);
    } catch (e) {
      if (activeIdRef.current === id) setError(toInfo(e));
    } finally {
      if (activeIdRef.current === id) setLoadingMessages(false);
    }
  }, [cancelStream]);

  const run = useCallback(async (retry: Retry) => {
    if (abortRef.current) return; // already generating
    setError(null);

    let convId = activeIdRef.current;
    if (!convId) {
      // Conversations are created lazily on the first message, so you never get empty "New chat" clutter.
      try {
        const created = await api.createConversation(mode);
        convId = created.id;
        activeIdRef.current = convId;
        setActiveId(convId);
        if (!searchRef.current) setConversations((prev) => [created, ...prev]);
      } catch (e) {
        setError(toInfo(e));
        retryRef.current = retry;
        return;
      }
    }

    const optimisticId = `local-${Date.now()}`;
    if ("regenerate" in retry) {
      setMessages((prev) => (prev.at(-1)?.role === "assistant" ? prev.slice(0, -1) : prev));
    } else {
      setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: retry.content }]);
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let accepted = false;
    let acc = "";
    setStreamingText("");

    try {
      const { message, conversation } = await streamMessage({
        conversationId: convId,
        mode,
        signal: ctrl.signal,
        ...("regenerate" in retry ? { regenerate: true } : { content: retry.content }),
        onStart: () => { accepted = true; },
        onDelta: (t) => { acc += t; if (activeIdRef.current === convId) setStreamingText(acc); },
      });
      if (activeIdRef.current === convId) setMessages((prev) => [...prev, message]);
      setConversations((prev) => (searchRef.current ? prev.map((c) => (c.id === conversation.id ? conversation : c)) : [conversation, ...prev.filter((c) => c.id !== conversation.id)]));
      retryRef.current = null;
    } catch (e) {
      if (activeIdRef.current === convId) {
        if (acc) setMessages((prev) => [...prev, { id: `partial-${Date.now()}`, role: "assistant", content: acc }]);
        const aborted = e instanceof DOMException && e.name === "AbortError";
        if (!aborted) {
          setError(toInfo(e));
          if (accepted) {
            retryRef.current = { regenerate: true };
          } else {
            // The server never saved this message, so take it off screen; Retry will resend it.
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            retryRef.current = retry;
          }
        }
      }
      void loadList(searchRef.current.trim());
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setStreamingText(null);
      }
    }
  }, [mode, loadList]);

  const send = useCallback((content: string) => run({ content }), [run]);
  const regenerate = useCallback(() => run({ regenerate: true }), [run]);
  const retry = useCallback(() => { if (retryRef.current) void run(retryRef.current); }, [run]);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      const updated = await api.renameConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (e) { setError(toInfo(e)); }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) newChat();
    } catch (e) { setError(toInfo(e)); }
  }, [newChat]);

  return {
    health, conversations, search, setSearch, activeId, messages, mode, setMode,
    streamingText, isStreaming: streamingText !== null, error, dismissError: () => setError(null),
    canRetry: retryRef.current !== null, loadingMessages, send, stop: cancelStream, regenerate, retry, newChat, select, rename, remove,
  };
}
