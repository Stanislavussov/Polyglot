import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const mockVocabularyRepository = {
  create: vi.fn().mockResolvedValue({ id: 1, translations: [] }),
  findByOriginalAndSource: vi.fn().mockResolvedValue(null),
};
const mockVocabularyDictionaryRepository = {
  addEntryToDefault: vi.fn().mockResolvedValue({ id: 1, name: "My Words" }),
  entryBelongsToDefault: vi.fn().mockResolvedValue(true),
};
const mockGetLang = vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" });
const mockTranslationTemplateRepository = {
  getByUserId: vi.fn().mockResolvedValue(null),
};

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    translateOne: vi.fn().mockResolvedValue({
      status: "accepted",
      output: {
        original: "hello",
        sourceLang: "en",
        emoji: "👋",
        nativeSynonyms: [],
        translations: {
          cs: { text: "regenerated", synonyms: [], examples: [] },
          de: { text: "hallo", synonyms: [], examples: [] },
        },
      },
      quality: {
        promptVersion: "translation-v1",
        schemaVersion: 1,
        riskLevel: "low" as const,
        modelId: "test-model",
        attemptCount: 1,
        issues: [],
      },
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import type { ServiceContainer, SupportedLang, TranslateOutput } from "@polyglot/core";
import { translateOne } from "@polyglot/core";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import { handleRegenLoop } from "./regen.helper.js";

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  nativeSynonyms: [],
  translations: {
    cs: {
      text: "ahoj",
      synonyms: [],
      examples: [],
    },
    de: {
      text: "hallo",
      synonyms: [],
      examples: [],
    },
  },
};

function createMockConversation(callbackSequence: string[]) {
  let callIdx = 0;
  const answerCallbackQuery = vi.fn();
  const editMessageText = vi.fn();

  return {
    conversation: {
      waitForCallbackQuery: vi.fn().mockImplementation(() => {
        const data = callbackSequence[callIdx++] ?? "tr:skip";
        return Promise.resolve({
          callbackQuery: { data },
          answerCallbackQuery,
          editMessageText,
        });
      }),
      waitUntil: vi.fn().mockImplementation(() => {
        const data = callbackSequence[callIdx++] ?? "tr:skip";
        return Promise.resolve({
          callbackQuery: { data },
          answerCallbackQuery,
          editMessageText,
        });
      }),
      external: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
    },
    answerCallbackQuery,
    editMessageText,
  };
}

function createMockCtx() {
  return {
    chat: { id: 123 },
    api: {
      editMessageText: vi.fn(),
    },
    reply: vi.fn(),
    services: createServicesStub({
      vocabularyRepository: mockVocabularyRepository as unknown as ServiceContainer["vocabularyRepository"],
      vocabularyDictionaryRepository:
        mockVocabularyDictionaryRepository as unknown as ServiceContainer["vocabularyDictionaryRepository"],
      translationTemplateRepository:
        mockTranslationTemplateRepository as unknown as ServiceContainer["translationTemplateRepository"],
      languageCache: { getLang: mockGetLang } as unknown as ServiceContainer["languageCache"],
    }),
  };
}

describe("handleRegenLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves to dictionary on tr:save with normalized vocabulary input", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(mockVocabularyRepository.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        original: "hello",
        sourceLangId: 1,
        inputType: "word",
        emoji: "👋",
        translations: expect.arrayContaining([
          expect.objectContaining({ text: "ahoj", targetLangId: 1 }),
          expect.objectContaining({ text: "hallo", targetLangId: 1 }),
        ]),
      }),
    );
  });

  it("renders saved card with savedToDict text and post-save keyboard on save", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    const [text, opts] = editMessageText.mock.calls[0]!;
    expect(text).toContain("Saved to dictionary");
    // Post-save keyboard: empty (no buttons)
    expect(opts.reply_markup.inline_keyboard.flat()).toEqual([]);
  });

  it("removes keyboard on tr:skip", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(mockVocabularyRepository.create).not.toHaveBeenCalled();
  });

  it("calls translateOne on regen and re-renders card", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(translateOne).toHaveBeenCalledTimes(1);
    const call = vi.mocked(translateOne).mock.calls[0]!;
    expect(call[0]).toMatchObject({
      word: "hello",
      sourceLang: "en",
      targetLang: "cs",
    });

    // Should re-render the card via ctx.api.editMessageText
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it("passes learner-friendly default outputConfig to translateOne", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    const call = vi.mocked(translateOne).mock.calls[0]!;
    expect(call[0].outputConfig).toEqual({
      includeExamples: false,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: false,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: true,
      includeGrammarBreakdown: false,
    });
  });

  it("shows loading message during regeneration", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:regen:de", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // First editMessageText call is the loading state
    const [loadingText] = editMessageText.mock.calls[0]!;
    expect(loadingText).toContain("Regenerating DE");
  });

  it("merges regenerated translation into saved vocabulary input", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // The saved input should have the regenerated CS translation
    const savedInput = vi.mocked(mockVocabularyRepository.create).mock.calls[0]![1]!;
    const csTranslation = savedInput.translations.find((t: any) => t.text === "regenerated");
    expect(csTranslation).toBeDefined();
    // DE should remain unchanged
    const deTranslation = savedInput.translations.find((t: any) => t.text === "hallo");
    expect(deTranslation).toBeDefined();
  });

  it("handles regeneration error gracefully and continues", async () => {
    vi.mocked(translateOne).mockRejectedValueOnce(new Error("AI down"));

    const { conversation } = createMockConversation(["tr:regen:cs", "tr:skip"]);
    const ctx = createMockCtx();

    // Should not throw
    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // Card is still re-rendered (with original translation since regen failed)
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it("supports multiple regenerations before save", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:regen:de", "tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(translateOne).toHaveBeenCalledTimes(2);
    expect(mockVocabularyRepository.create).toHaveBeenCalledTimes(1);
  });

  it("answers callback query for each interaction", async () => {
    const { conversation, answerCallbackQuery } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("detects duplicates and shows alreadySaved toast", async () => {
    vi.mocked(mockVocabularyRepository.findByOriginalAndSource).mockResolvedValueOnce({ id: 99 } as any);
    const { conversation, answerCallbackQuery } = createMockConversation(["tr:save", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // First save attempt should show "already saved" and continue loop
    expect(answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("already"), show_alert: true }),
    );
    // No new entry should be created
    expect(mockVocabularyRepository.create).not.toHaveBeenCalled();
  });

  it("resolves sourceLangId via getLang for save", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(mockGetLang).toHaveBeenCalledWith("en");
    expect(mockVocabularyRepository.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        sourceLangId: 1,
      }),
    );
  });

  it("passes inputType to mockVocabularyRepository.create", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42, "phrase");

    expect(mockVocabularyRepository.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        inputType: "phrase",
      }),
    );
  });
});
