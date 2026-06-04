import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "./types.js";

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

  it("returns undefined and deletes corrupt session data", async () => {
    getSessionFn.mockResolvedValueOnce({ data: { activeMode: "bad" } });

    await expect(createPostgresSessionStorage().read("123")).resolves.toBeUndefined();

    expect(deleteSessionFn).toHaveBeenCalledWith("123");
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
});
