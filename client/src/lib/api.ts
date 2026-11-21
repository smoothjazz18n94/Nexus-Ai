import type { Conversation, Health, Message, Mode } from "../types";
import { SSEParser } from "./sse";

export interface ApiErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export class ApiError extends Error implements ApiErrorInfo {
  code: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.code = info.code;
    this.retryable = info.retryable;
    if (info.retryAfterSeconds !== undefined) this.retryAfterSeconds = info.retryAfterSeconds;
  }
}

const networkError = () =>
  new ApiError({ code: "network", message: "Can't reach the server. Check your connection and try again.", retryable: true });

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: ApiErrorInfo };
    if (body.error) return new ApiError(body.error);
  } catch { /* fall through */ }
  return new ApiError({ code: "internal", message: `Request failed (${res.status}).`, retryable: res.status >= 500 });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw networkError();
  }
  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  health: () => request<Health>("/health"),
  listConversations: (q?: string) =>
    request<{ conversations: Conversation[] }>(`/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.conversations),
  createConversation: (mode: Mode) =>
    request<{ conversation: Conversation }>("/conversations", { method: "POST", body: JSON.stringify({ mode }) }).then((r) => r.conversation),
  getConversation: (id: string) => request<{ conversation: Conversation; messages: Message[] }>(`/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    request<{ conversation: Conversation }>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then((r) => r.conversation),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
};

export interface StreamOptions {
  conversationId: string;
  mode: Mode;
  content?: string;
  regenerate?: boolean;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Called once the server accepted the request, i.e. the user's message is saved. */
  onStart?: () => void;
  /** Give up if the server sends nothing for this long (the server's own timeout is shorter). */
  idleTimeoutMs?: number;
}

/** Send a message and read the streamed reply. Resolves with the saved assistant message. */
export async function streamMessage(opts: StreamOptions): Promise<{ message: Message; conversation: Conversation }> {
  // `ctrl` is cancelled by the user (Stop) or by our idle timer.
  const ctrl = new AbortController();
  const onUserAbort = () => ctrl.abort();
  if (opts.signal.aborted) ctrl.abort();
  else opts.signal.addEventListener("abort", onUserAbort, { once: true });

  let idled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { idled = true; ctrl.abort(); }, opts.idleTimeoutMs ?? 45_000);
  };
  const timedOut = () =>
    new ApiError({ code: "provider_timeout", message: "The server stopped responding. Please retry.", retryable: true });

  try {
    arm();
    let res: Response;
    try {
      res = await fetch(`/api/conversations/${opts.conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: opts.content, mode: opts.mode, regenerate: opts.regenerate ?? false }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (idled) throw timedOut();
      if (opts.signal.aborted) throw e;
      throw networkError();
    }
    if (!res.ok) throw await toApiError(res);
    if (!res.body) throw networkError();
    opts.onStart?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SSEParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm(); // data arrived
        for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
          const data = JSON.parse(ev.data);
          if (ev.event === "delta") opts.onDelta(data.text as string);
          else if (ev.event === "done") return data as { message: Message; conversation: Conversation };
          else if (ev.event === "error") throw new ApiError(data as ApiErrorInfo);
        }
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (idled) throw timedOut();
      if (opts.signal.aborted) throw e;
      throw new ApiError({ code: "network", message: "The connection was interrupted.", retryable: true });
    }
    if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw new ApiError({ code: "network", message: "The connection was interrupted.", retryable: true });
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", onUserAbort);
  }
}
