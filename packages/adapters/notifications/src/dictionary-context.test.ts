import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationServiceDeps, VocabEntry } from "./types.js";

const { mockLogger, mockChild } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockChild: vi.fn(() => mockLogger),
}));

vi.mock("@polyglot/core", () => ({
  getLogger: vi.fn(() => ({
    info: mockLogger.info,
    warn: mockLogger.warn,
    error: mockLogger.error,
    child: mockChild,
  })),
}));

import { createNotificationService } from "./notification.service.js";

const mockEntry: VocabEntry = {
  id: 1,
  original: "hello",
  emoji: "👋",
  createdAt: new Date(),
  translations: [{ targetLangId: 1, text: "ahoj" }],
};

function buildDeps(): NotificationServiceDeps {
  return {
    getUserVocabulary: vi.fn().mockResolvedValue([mockEntry]),
    getLangCode: vi.fn().mockReturnValue("cs"),
  };
}

describe("createNotificationService — dictionary only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("returns a dictionary word with source: srs", async () => {
    const service = createNotificationService(buildDeps());
    const result = await service.pickDictionaryWord(1);

    expect(result).toEqual({
      original: "hello",
      emoji: "👋",
      translations: { cs: "ahoj" },
      source: "srs",
    });
  });

  it("has no pickSuggestedWord method", () => {
    const service = createNotificationService(buildDeps());
    expect("pickSuggestedWord" in service).toBe(false);
  });

  it("SuggestedWord has no dictionaryContext", async () => {
    const service = createNotificationService(buildDeps());
    const result = await service.pickDictionaryWord(1);

    expect(result).not.toBeNull();
    expect("dictionaryContext" in result!).toBe(false);
  });
});
