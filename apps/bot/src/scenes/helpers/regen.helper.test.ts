import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  vocabularyRepository: {
    create: vi.fn().mockResolvedValue({ id: 1, translations: [] }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
  },
  vocabularyDictionaryRepository: {
    addEntryToDefault: vi.fn().mockResolvedValue({ id: 1, name: "My Words" }),
    entryBelongsToDefault: vi.fn().mockResolvedValue(true),
  },
  getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
  translationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    translateOne: vi.fn().mockResolvedValue({
      text: "regenerated",
      synonyms: [],
      examples: [],
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getLang, vocabularyRepository } from "@polyglot/adapter-db";
import type { SupportedLang, TranslateOutput } from "@polyglot/core";
import { translateOne } from "@polyglot/core";
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

    expect(vocabularyRepository.create).toHaveBeenCalledWith(
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
    // Post-save keyboard: regen buttons only, no save/skip
    const allCallbacks = opts.reply_markup.inline_keyboard.flatMap((row: any[]) =>
      row.map((b: any) => b.callback_data),
    );
    expect(allCallbacks).toContain("tr:regen:cs:0");
    expect(allCallbacks).not.toContain("tr:save:");
    expect(allCallbacks).not.toContain("tr:skip:");
  });

  it("removes keyboard on tr:skip", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(vocabularyRepository.create).not.toHaveBeenCalled();
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

  it("passes reliable default outputConfig to translateOne", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    const call = vi.mocked(translateOne).mock.calls[0]!;
    expect(call[0].outputConfig).toEqual({
      includeExamples: false,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
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
    const savedInput = vi.mocked(vocabularyRepository.create).mock.calls[0]![1]!;
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
    expect(vocabularyRepository.create).toHaveBeenCalledTimes(1);
  });

  it("answers callback query for each interaction", async () => {
    const { conversation, answerCallbackQuery } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("detects duplicates and shows alreadySaved toast", async () => {
    vi.mocked(vocabularyRepository.findByOriginalAndSource).mockResolvedValueOnce({ id: 99 } as any);
    const { conversation, answerCallbackQuery } = createMockConversation(["tr:save", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // First save attempt should show "already saved" and continue loop
    expect(answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("already"), show_alert: true }),
    );
    // No new entry should be created
    expect(vocabularyRepository.create).not.toHaveBeenCalled();
  });

  it("resolves sourceLangId via getLang for save", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(getLang).toHaveBeenCalledWith("en");
    expect(vocabularyRepository.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        sourceLangId: 1,
      }),
    );
  });

  it("passes inputType to vocabularyRepository.create", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42, "phrase");

    expect(vocabularyRepository.create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        inputType: "phrase",
      }),
    );
  });
});
