import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  wordRepository: {
    create: vi.fn().mockResolvedValue({ id: "w1" }),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    translateOne: vi.fn().mockResolvedValue({
      text: "regenerated",
      cefr: "B1",
      register: "neutral",
      synonyms: [],
      examples: [],
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { wordRepository } from "@polyglot/adapter-db";
import type { SupportedLang, TranslateOutput } from "@polyglot/core";
import { translateOne } from "@polyglot/core";
import { handleRegenLoop } from "./regen.helper.js";

const sampleOutput: TranslateOutput = {
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
    de: {
      text: "hallo",
      cefr: "A1",
      register: "neutral",
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

  it("saves to dictionary on tr:save", async () => {
    const { conversation } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(wordRepository.create).toHaveBeenCalledWith(1, {
      original: "hello",
      sourceLang: "en",
      content: sampleOutput,
    });
  });

  it("renders saved card with savedToDict text on save", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    const [text] = editMessageText.mock.calls[0]!;
    expect(text).toContain("Saved to dictionary");
  });

  it("removes keyboard on tr:skip", async () => {
    const { conversation, editMessageText } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(wordRepository.create).not.toHaveBeenCalled();
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

  it("passes FULL_OUTPUT preset as outputConfig to translateOne", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    const call = vi.mocked(translateOne).mock.calls[0]!;
    expect(call[0].outputConfig).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: true,
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

  it("merges regenerated translation into output", async () => {
    const { conversation } = createMockConversation(["tr:regen:cs", "tr:save"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    // The saved content should have the regenerated CS translation
    const savedContent = vi.mocked(wordRepository.create).mock.calls[0]![1]!.content as TranslateOutput;
    expect(savedContent.translations.cs.text).toBe("regenerated");
    // DE should remain unchanged
    expect(savedContent.translations.de.text).toBe("hallo");
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
    expect(wordRepository.create).toHaveBeenCalledTimes(1);
  });

  it("answers callback query for each interaction", async () => {
    const { conversation, answerCallbackQuery } = createMockConversation(["tr:skip"]);
    const ctx = createMockCtx();

    await handleRegenLoop(conversation as any, ctx as any, sampleOutput, "en" as SupportedLang, 1, 42);

    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
  });
});
