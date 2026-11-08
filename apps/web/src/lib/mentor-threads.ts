import type { MentorTurn } from "./types";

export interface MentorThread {
  id: string;
  title: string;
  updatedAt: number;
  turns: MentorTurn[];
}

const KEY = "polyglot.mentor.threads";
// Enough history to come back to a topic; the server reads only the last window anyway.
const MAX_THREADS = 20;
const MAX_TURNS = 40;
const TITLE_LENGTH = 60;

/** Web threads live in the browser: the server's mentor_messages rows are keyed by Telegram ids. */
export function loadThreads(): MentorThread[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as MentorThread[]) : [];
  } catch {
    return [];
  }
}

export function saveThread(threads: MentorThread[], thread: MentorThread): MentorThread[] {
  const trimmed = { ...thread, turns: thread.turns.slice(-MAX_TURNS) };
  const next = [trimmed, ...threads.filter((other) => other.id !== thread.id)].slice(0, MAX_THREADS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage loses only the history, never the conversation on screen.
  }
  return next;
}

export function newThread(firstQuestion: string): MentorThread {
  const title = firstQuestion.length > TITLE_LENGTH ? `${firstQuestion.slice(0, TITLE_LENGTH)}…` : firstQuestion;
  return { id: crypto.randomUUID(), title, updatedAt: Date.now(), turns: [] };
}
