/**
 * Tests for dictionary context integration in translate-mode helper.
 * Covers lookupDictContext and dictionaryContext wiring in handleTranslateText.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn(),
  },
  wordRepository: {
    create: vi.fn(),
  },
  wordContextRepository: {
    findByWordAndLangCode: vi.fn(),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>(
    "@polyglot/core",
  );
  return {
    ...actual,
    translate: vi.fn().mockResolvedValue({
      original: "hello",
      sourceLang: "en",
      emoji: "👋",
      register: "neutral",
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1",
          register: "colloquial",
          synonyms: [],
          examples: [],
        },
      },
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { lookupDictContext, handleTranslateText } from "./translate-mode.helper.js";
import { wordContextRepository } from "@polyglot/adapter-db";
import { userRepository } from "@polyglot/adapter-db";
import { translate } from "@polyglot/core";
import type { BotContext, SessionData } from "../../types.js";

function createMockCtx(overrides: Partial<{ nativeLang: string; learningLangs: string[] }> = {}): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 123456789 },
  } as unknown as BotContext;
}

describe("lookupDictContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns DictionaryContext when word is found", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([
      {
        id: 1,
        word: "что ли",
        languageId: 1,
        pos: "phrase",
        formTags: ["canonical"],
        glosses: ["or something", "perhaps"],
        createdAt: new Date(),
      },
    ]);

    const result = await lookupDictContext("что ли", "ru");

    expect(result).toEqual({
      word: "что ли",
      pos: "phrase",
      glosses: ["or something", "perhaps"],
      formTags: ["canonical"],
      langCode: "ru",
    });
  });

  it("returns undefined when no results found", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([]);

    const result = await lookupDictContext("unknown", "en");

    expect(result).toBeUndefined();
  });

  it("returns undefined when repository throws (fail-open)", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockRejectedValue(
      new Error("DB connection failed"),
    );

    const result = await lookupDictContext("hello", "en");

    expect(result).toBeUndefined();
  });

  it("uses the first result when multiple entries found", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([
      {
        id: 1,
        word: "bank",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["financial institution"],
        createdAt: new Date(),
      },
      {
        id: 2,
        word: "bank",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["riverbank"],
        createdAt: new Date(),
      },
    ]);

    const result = await lookupDictContext("bank", "en");

    expect(result?.glosses).toEqual(["financial institution"]);
  });

  it("handles null glosses and formTags gracefully", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([
      {
        id: 1,
        word: "test",
        languageId: 1,
        pos: "noun",
        formTags: null,
        glosses: null,
        createdAt: new Date(),
      },
    ]);

    const result = await lookupDictContext("test", "en");

    expect(result).toEqual({
      word: "test",
      pos: "noun",
      glosses: [],
      formTags: [],
      langCode: "en",
    });
  });
});

describe("handleTranslateText — dictionary context wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "de"],
    } as any);
  });

  it("passes dictionaryContext to translate() when found", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([
      {
        id: 1,
        word: "привет",
        languageId: 1,
        pos: "noun",
        formTags: ["canonical"],
        glosses: ["greeting", "hello"],
        createdAt: new Date(),
      },
    ]);

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "привет",
        dictionaryContext: {
          word: "привет",
          pos: "noun",
          glosses: ["greeting", "hello"],
          formTags: ["canonical"],
          langCode: "ru",
        },
      }),
      expect.anything(),
    );
  });

  it("passes undefined dictionaryContext when not found", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([]);

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "unknown_word");

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "unknown_word",
        dictionaryContext: undefined,
      }),
      expect.anything(),
    );
  });

  it("proceeds with translation when lookup fails", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockRejectedValue(
      new Error("DB error"),
    );

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    // translate() should still be called
    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "hello",
        dictionaryContext: undefined,
      }),
      expect.anything(),
    );
  });

  it("looks up word using the source language code", async () => {
    vi.mocked(wordContextRepository.findByWordAndLangCode).mockResolvedValue([]);

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "bonjour");

    expect(wordContextRepository.findByWordAndLangCode).toHaveBeenCalledWith(
      "bonjour",
      "ru", // nativeLang from settings
    );
  });
});
