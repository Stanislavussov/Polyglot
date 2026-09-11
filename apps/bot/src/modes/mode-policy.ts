import type { UserMode } from "@polyglot/adapter-db";
import type { MentorIdleHold, SessionData } from "../types.js";

export interface ModePolicy {
  /** How long a mode tolerates silence before re-confirming; null = never asks. */
  idleTimeoutMs: number | null;
}

/** Exhaustive over UserMode on purpose: a new mode fails the build until it declares a policy. */
export const MODE_POLICIES: Record<UserMode, ModePolicy> = {
  idle: { idleTimeoutMs: null },
  translate: { idleTimeoutMs: null },
  mentor: { idleTimeoutMs: 15 * 60_000 },
};

/**
 * Mode entry (`/mentor`, "New topic"): starts a *fresh* thread and stamps now.
 * No `threadId` key — that absence is the fresh-thread sentinel `resolveThreadId`
 * reads, so writing one here would silently pin (or recover) the wrong thread.
 */
export function startMentorThread(session: SessionData): void {
  session.mentor = { lastTurnAt: Date.now() };
  session.mentorIdlePrompt = undefined;
}

/**
 * Stamps mentor activity, preserving an existing pin when called without a threadId.
 *
 * A session whose `mentor` is `undefined` must stay `undefined`: `resolveThreadId`
 * (mentor-mode.helper.ts) recovers the latest thread from the DB only in that state,
 * so materialising an object here would permanently disable recovery. The object is
 * built conditionally so a fresh sentinel never gains a literal `threadId: undefined`
 * key — in-memory absence then matches persisted absence.
 */
export function markMentorActivity(session: SessionData, threadId?: string): void {
  const pinned = threadId ?? session.mentor?.threadId;
  session.mentorIdlePrompt = undefined;
  if (pinned === undefined && session.mentor === undefined) return;
  session.mentor = pinned === undefined ? { lastTurnAt: Date.now() } : { threadId: pinned, lastTurnAt: Date.now() };
}

export function isMentorIdle(session: SessionData, now: number): boolean {
  const timeout = MODE_POLICIES[session.activeMode].idleTimeoutMs;
  const last = session.mentor?.lastTurnAt;
  return timeout !== null && last !== undefined && now - last >= timeout;
}

/**
 * Reads and consumes the held message. One-shot and synchronous (before any `await`),
 * mirroring `takeRetryAction`: a second tap must not launch the same paid turn twice.
 */
export function takeMentorIdlePrompt(session: SessionData): MentorIdleHold | undefined {
  const hold = session.mentorIdlePrompt;
  if (!hold) return undefined;
  session.mentorIdlePrompt = undefined;
  return hold;
}
