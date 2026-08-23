import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionData, USER_MODES } from "./types.js";

const getSessionFn = vi.fn();
const upsertSessionFn = vi.fn();
const deleteSessionFn = vi.fn();

vi.mock("@polyglot/adapter-db", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/adapter-db")>("@polyglot/adapter-db");
  return {
    ...actual,
    BOT_SESSION_VERSION: 1,
    botSessionRepository: {
      get: getSessionFn,
      upsert: upsertSessionFn,
      delete: deleteSessionFn,
    },
  };
});

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  };
});

const { createPostgresSessionStorage, isValidSessionData } = await import("./session-storage.js");
const { sessionStorageDuration } = await import("./metrics.js");

async function storageOpCount(op: "read" | "write" | "delete"): Promise<number> {
  const { values } = await sessionStorageDuration.get();
  const match = values.find((v) => (v as { metricName?: string }).metricName?.endsWith("_count") && v.labels.op === op);
  return match?.value ?? 0;
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    translationMap: {},
    needsTranslateReminder: true,
    templateWizard: undefined,
    dictionary: undefined,
    flashcard: undefined,
    srs: undefined,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionFn.mockResolvedValue(null);
  upsertSessionFn.mockResolvedValue(undefined);
  deleteSessionFn.mockResolvedValue(undefined);
});

describe("isValidSessionData", () => {
  it("accepts current session data", () => {
    expect(isValidSessionData(makeSession())).toBe(true);
  });

  // Exhaustiveness: every declared UserMode must pass validation, so a mode
  // added to the union without updating VALID_MODES is caught here (T01).
  it.each(USER_MODES)("accepts activeMode '%s'", (mode) => {
    expect(isValidSessionData(makeSession({ activeMode: mode }))).toBe(true);
  });

  it("rejects corrupt session payloads", () => {
    expect(isValidSessionData(null)).toBe(false);
    expect(isValidSessionData({})).toBe(false);
    expect(isValidSessionData({ activeMode: "unknown" })).toBe(false);
  });
});

describe("createPostgresSessionStorage", () => {
  it("reads valid session data", async () => {
    const session = makeSession({ activeMode: "idle" });
    getSessionFn.mockResolvedValueOnce({ data: session });

    await expect(createPostgresSessionStorage().read("123")).resolves.toEqual(session);
  });

  it("returns undefined and deletes unrecoverable (non-object) session data", async () => {
    getSessionFn.mockResolvedValueOnce({ data: "totally-corrupt" });

    await expect(createPostgresSessionStorage().read("123")).resolves.toBeUndefined();

    expect(deleteSessionFn).toHaveBeenCalledWith("123");
  });

  // T01: a bad activeMode must be repaired in place, NOT trigger a full wipe —
  // otherwise translationMap / mentor history are lost on every update.
  it("repairs an invalid activeMode without discarding other session state", async () => {
    const stored = {
      activeMode: "bad",
      translationMap: { "42": { output: {}, inputType: "word" } },
      mentor: { history: [{ role: "user", content: "hola" }] },
    };
    getSessionFn.mockResolvedValueOnce({ data: stored });

    const result = await createPostgresSessionStorage().read("123");

    expect(deleteSessionFn).not.toHaveBeenCalled();
    expect(result?.activeMode).toBe("translate");
    expect(result?.translationMap).toEqual(stored.translationMap);
    expect(result?.mentor).toEqual(stored.mentor);
    // The repair is persisted so the next read is already clean.
    expect(upsertSessionFn).toHaveBeenCalledWith("123", result);
  });

  it("does not wipe a mentor session on read", async () => {
    const mentorSession = makeSession({
      activeMode: "mentor",
      mentor: { threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    getSessionFn.mockResolvedValueOnce({ data: mentorSession });

    await expect(createPostgresSessionStorage().read("123")).resolves.toEqual(mentorSession);
    expect(deleteSessionFn).not.toHaveBeenCalled();
  });

  it("upserts session data on write", async () => {
    const session = makeSession();

    await createPostgresSessionStorage().write("123", session);

    expect(upsertSessionFn).toHaveBeenCalledWith("123", session);
  });

  it("deletes session data", async () => {
    await createPostgresSessionStorage().delete("123");

    expect(deleteSessionFn).toHaveBeenCalledWith("123");
  });

  it("records the latency of every storage round-trip so DB slowness is visible in Prometheus", async () => {
    sessionStorageDuration.reset();
    const storage = createPostgresSessionStorage();

    await storage.read("123");
    await storage.write("123", makeSession());
    await storage.delete("123");

    expect(await storageOpCount("read")).toBe(1);
    expect(await storageOpCount("write")).toBe(1);
    expect(await storageOpCount("delete")).toBe(1);
  });
});
