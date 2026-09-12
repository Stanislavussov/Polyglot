import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentorIdleHold, SessionData } from "../../types.js";
import { isMentorIdle, markMentorActivity, startMentorThread, takeMentorIdlePrompt } from "../mode-policy.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const MINUTE = 60_000;

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return { activeMode: "mentor", ...overrides };
}

function makeHold(): MentorIdleHold {
  return { text: "how do I say hello?", promptMsgId: 42 };
}

beforeEach(() => {
  // Date only — the writers read Date.now(); faking timers would buy nothing.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startMentorThread", () => {
  it("stamps now and leaves threadId absent as the fresh-thread sentinel", () => {
    const session = makeSession({ mentor: { threadId: "old-thread", lastTurnAt: 1 } });

    startMentorThread(session);

    expect(session.mentor).toEqual({ lastTurnAt: NOW.getTime() });
    expect(session.mentor).not.toHaveProperty("threadId");
  });

  it("clears an open idle hold", () => {
    const session = makeSession({ mentorIdlePrompt: makeHold() });

    startMentorThread(session);

    expect(session.mentorIdlePrompt).toBeUndefined();
  });
});

describe("markMentorActivity", () => {
  it("pins the given thread and stamps now", () => {
    const session = makeSession({ mentorIdlePrompt: makeHold() });

    markMentorActivity(session, "thread-1");

    expect(session.mentor).toEqual({ threadId: "thread-1", lastTurnAt: NOW.getTime() });
    expect(session.mentorIdlePrompt).toBeUndefined();
  });

  it("keeps an existing pin and advances the stamp when called without a threadId", () => {
    const session = makeSession({ mentor: { threadId: "thread-1", lastTurnAt: NOW.getTime() - 30 * MINUTE } });

    markMentorActivity(session);

    expect(session.mentor).toEqual({ threadId: "thread-1", lastTurnAt: NOW.getTime() });
  });

  it("leaves a lost session undefined so DB thread recovery still runs, but still clears the hold", () => {
    const session = makeSession({ mentorIdlePrompt: makeHold() });

    markMentorActivity(session);

    expect(session.mentor).toBeUndefined();
    expect(session.mentorIdlePrompt).toBeUndefined();
  });

  it("keeps threadId absent on a fresh sentinel when called without a threadId", () => {
    const session = makeSession({ mentor: { lastTurnAt: NOW.getTime() - MINUTE } });

    markMentorActivity(session);

    expect(session.mentor).toEqual({ lastTurnAt: NOW.getTime() });
    expect(session.mentor).not.toHaveProperty("threadId");
  });
});

describe("isMentorIdle", () => {
  it("reports idle once the mentor timeout has elapsed", () => {
    const session = makeSession({ mentor: { lastTurnAt: NOW.getTime() - 16 * MINUTE } });

    expect(isMentorIdle(session, NOW.getTime())).toBe(true);
  });

  it("stays inside the window for a recent turn", () => {
    const session = makeSession({ mentor: { lastTurnAt: NOW.getTime() - 2 * MINUTE } });

    expect(isMentorIdle(session, NOW.getTime())).toBe(false);
  });

  it("never reports idle without a stamp", () => {
    expect(isMentorIdle(makeSession({ mentor: {} }), NOW.getTime())).toBe(false);
    expect(isMentorIdle(makeSession(), NOW.getTime())).toBe(false);
  });

  it("never reports idle in a mode with no idle policy", () => {
    const session = makeSession({ activeMode: "translate", mentor: { lastTurnAt: NOW.getTime() - 16 * MINUTE } });

    expect(isMentorIdle(session, NOW.getTime())).toBe(false);
  });
});

describe("takeMentorIdlePrompt", () => {
  it("returns the hold once and nothing on a second tap", () => {
    const hold = makeHold();
    const session = makeSession({ mentorIdlePrompt: hold });

    expect(takeMentorIdlePrompt(session)).toEqual(hold);
    expect(takeMentorIdlePrompt(session)).toBeUndefined();
  });
});
