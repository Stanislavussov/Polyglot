/**
 * Tests for auto-detect input language integration in translate-mode helper.
 * Covers resolveTranslationDirection wiring and detected language display.
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
        ru: {
          text: "привет",
          cefr: "A1",
          register: "colloquial",
          synonyms: [],
          examples: [],
        },
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

import { handleTranslateText } from "../translate-mode.helper.js";
import { userRepository } from "@polyglot/adapter-db";
import { translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../../types.js";

function createMockCtx(): BotContext {
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

describe("handleTranslateText — auto-detect language direction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
  });

  it("detects English input from Russian user → sourceLang='en', targetLangs include 'ru'", async () => {
    // Use settings with only one Latin learning lang so script heuristic is unambiguous
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    } as any);

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "hello",
        sourceLang: "en",
        targetLangs: ["ru"],
      }),
      expect.anything(),
    );
  });

  it("detects Russian (Cyrillic) input → sourceLang='ru', targetLangs are learning langs", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "привет",
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("shows detected language indicator when direction is reversed", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    } as any);

    const ctx = createMockCtx();
    // With only one Latin candidate (en), script heuristic returns "en"
    await handleTranslateText(ctx, "hello");

    // Card should include the detected language indicator (🔍 Detected: English)
    const replyCall = vi.mocked(ctx.reply).mock.calls.find(
      (call) => call[1] && (call[1] as any).parse_mode === "HTML",
    );
    expect(replyCall).toBeDefined();
    // i18n key 'detectedLang' → "🔍 Detected: {lang}" with lang=English
    expect(replyCall![0]).toContain("English");
  });

  it("does NOT show detected language indicator for native language input", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    // Card should NOT have the detected lang prefix
    const replyCall = vi.mocked(ctx.reply).mock.calls.find(
      (call) => call[1] && (call[1] as any).parse_mode === "HTML",
    );
    expect(replyCall).toBeDefined();
    expect(replyCall![0]).not.toContain("Detected:");
  });

  it("falls back to native→learning for ambiguous input", async () => {
    const ctx = createMockCtx();
    // Emoji/number only — no language detected, should fallback
    await handleTranslateText(ctx, "123 🎉");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("handles single learning language with reversed direction", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    } as any);

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    // Detected en (only Latin candidate) → source=en, target=[ru]
    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "en",
        targetLangs: ["ru"],
      }),
      expect.anything(),
    );
  });

  it("passes detected direction to translateWithContext correctly for Czech input", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs"],
    } as any);

    const ctx = createMockCtx();
    // "dobrý den" — single Latin candidate (cs) → detected as cs
    await handleTranslateText(ctx, "dobrý den");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "cs",
        targetLangs: ["ru"],
      }),
      expect.anything(),
    );
  });

  it("logs debug info about resolved direction", async () => {
    const { logger } = await import("@polyglot/infra");
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "привет",
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      "Resolved translation direction",
    );
  });
});
