/**
 * Tests for dictionary context integration in translate-mode helper.
 * Covers lookupDictContext and dictionaryContext wiring in handleTranslateText.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const { mockLookupContext } = vi.hoisted(() => ({
  mockLookupContext: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn(),
  },
  wordRepository: {
    create: vi.fn(),
  },
  createContextLookup: () => mockLookupContext,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>(
    "@polyglot/core",
  );
  return {
    ...actual,
    translateWithContext: vi.fn().mockResolvedValue({
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

import { handleTranslateText } from "./translate-mode.helper.js";
import { userRepository } from "@polyglot/adapter-db";
import { translateWithContext } from "@polyglot/core";
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

describe("handleTranslateText — context enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "de"],
    } as any);
  });

  it("calls translateWithContext with correct input and deps", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "привет",
        sourceLang: "ru",
        targetLangs: ["cs", "de"],
      }),
      expect.objectContaining({
        lookupContext: mockLookupContext,
        generateObjectFn: expect.any(Function),
      }),
    );
  });

  it("passes FULL_OUTPUT preset as outputConfig", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(inputArg.outputConfig).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: true,
    });
  });

  it("passes lookupContext from createContextLookup to deps", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const depsArg = vi.mocked(translateWithContext).mock.calls[0]![1];
    expect(depsArg.lookupContext).toBe(mockLookupContext);
  });

  it("does not include dictionaryContext in input (layer fills it)", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect("dictionaryContext" in inputArg).toBe(false);
  });

  it("includes userId in translateWithContext input", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
      }),
      expect.anything(),
    );
  });
});
