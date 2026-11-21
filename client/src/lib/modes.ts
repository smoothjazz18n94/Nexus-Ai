import type { Mode } from "../types";

export interface ModeMeta { id: Mode; label: string; placeholder: string }

export const MODES: ModeMeta[] = [
  { id: "chat", label: "Chat", placeholder: "Message Nexus AI" },
  { id: "summarize", label: "Summarize", placeholder: "Paste the text you want summarized" },
  { id: "rewrite", label: "Rewrite", placeholder: "Paste text and say how it should change (tone, length, audience)" },
  { id: "explain", label: "Explain", placeholder: "What concept or code should I explain?" },
  { id: "brainstorm", label: "Brainstorm", placeholder: "What do you need ideas for?" },
];

export interface ExamplePrompt { mode: Mode; title: string; prompt: string }

export const EXAMPLES: ExamplePrompt[] = [
  {
    mode: "explain",
    title: "Explain closures in JavaScript",
    prompt: "Explain closures in JavaScript with a small example, and show one common bug they cause in loops.",
  },
  {
    mode: "rewrite",
    title: "Make an email sound more confident",
    prompt:
      'Rewrite this to sound confident but friendly, in under 50 words:\n\n"Hi, sorry to bother you, I was just wondering if maybe you could possibly look at my report when you get a chance? No worries at all if not!"',
  },
  {
    mode: "summarize",
    title: "Summarize meeting notes",
    prompt:
      "Summarize these notes into decisions and action items:\n\nMon sync: launch moved to the 14th because QA found a payment bug. Priya owns the fix, due Wednesday. Marketing wants a teaser post Thursday. Budget unchanged. Sam to confirm the support rota.",
  },
  {
    mode: "brainstorm",
    title: "Name a side project",
    prompt: "Brainstorm names for a developer portfolio project that is an AI productivity workspace.",
  },
  {
    mode: "explain",
    title: "Review a SQL query",
    prompt: "What does this SQL do, and how could it be faster?\n\nSELECT * FROM orders WHERE LOWER(email) = 'a@b.com' ORDER BY created_at DESC;",
  },
  {
    mode: "chat",
    title: "Plan a focused work week",
    prompt: "Help me plan a focused work week. I have 3 deadlines, 2 meetings a day, and tend to lose mornings to email.",
  },
];
