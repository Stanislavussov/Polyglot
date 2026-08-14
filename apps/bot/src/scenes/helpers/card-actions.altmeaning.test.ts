/**
 * Tests for the append-not-edit behavior of "Other meaning"
 * (handleAltMeaningCallback): a new sense is sent as a NEW card, the previous
 * card is left untouched as a snapshot, and the accumulated negative
 * constraints are carried forward into the new card's session entry so a
 * further tap still excludes every sense shown so far.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

// Spread the real module rather than enumerating exports: an exhaustive mock
// breaks whenever the code under test reaches for a new core export, and the
// failure surfaces as an unrelated "No X export is defined" at import time.
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    defaultFeatureAccess: { checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: true }) },
    generateEtymology: vi.fn(),
    generateGrammarBreakdown: vi.fn(),
    generateGrammarDetail: vi.fn(),
    getLangFlag: vi.fn(() => "🏳️"),
    isSupported: vi.fn(() => true),
    logger: mockLogger,
    resolveOutputConfig: vi.fn(() => ({})),
    resolveTemplate: vi.fn(() => ({ fields: {} })),
    t: vi.fn((key: string) => `[${key}]`),
    translateWithContext: vi.fn(),
  };
});

vi.mock("../../renderers/translation.renderer.js", () => ({
  buildGrammarLangKeyboard: vi.fn(() => ({ inline_keyboard: [] })),
  buildTranslationKeyboard: vi.fn(() => ({ inline_keyboard: [] })),
  renderSentenceTranslation: vi.fn(() => "SENTENCE"),
  renderTranslation: vi.fn(() => "CARD_BODY"),
}));
vi.mock("../../utils/ai-model.js", () => ({ resolveDefaultAIModel: vi.fn().mockResolvedValue("test-model") }));
vi.mock("../../utils/long-op.js", () => ({
  isUserFacingTimeout: vi.fn(() => false),
  LONG_OP_TIMEOUT_MS: 10000,
  loadingKeyboard: vi.fn(() => ({ inline_keyboard: [] })),
  NOOP_CALLBACK: "noop",
  withTimeout: <T>(p: Promise<T>) => p,
}));
vi.mock("../../utils/vocabulary-mapper.js", () => ({ toVocabularyInput: vi.fn() }));
vi.mock("./edit-message.helper.js", () => ({
  editMessageReplyMarkupOrIgnore: vi.fn().mockResolvedValue(undefined),
  editMessageTextOrReply: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./translate-mode.shared.js", () => ({ isEtymologyEligible: vi.fn(() => false) }));

import type { QualityMetadata, TranslateOutput } from "@polyglot/core";
import { translateWithContext } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { handleAltMeaningCallback } from "./card-actions.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";

const OLD_CARD_ID = 100;

const quality: QualityMetadata = {
  promptVersion: "translation-v1",
  schemaVersion: 1,
  riskLevel: "low",
  modelId: "test-model",
  attemptCount: 1,
  issues: [],
};

const acceptedOutput: TranslateOutput = {
  original: "pero",
  sourceLang: "es",
  nativeSynonyms: [],
  translations: { ru: { text: "перо", synonyms: [], examples: [] } },
};

function createCtx(): BotContext {
  let nextMsgId = 200;
  const session = {
    activeMode: "translate" as const,
    translationMap: {
      [String(OLD_CARD_ID)]: {
        output: {
          original: "pero",
          sourceLang: "es",
          nativeSynonyms: [],
          translations: { ru: { text: "но", synonyms: [], examples: [] } },
        },
        inputType: "word" as const,
        contextHint: undefined,
        addedAt: 1,
      },
    },
  };
  return {
    callbackQuery: { id: "cbq", data: `tr:altmeaning:${OLD_CARD_ID}` },
    chat: { id: 555 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockImplementation(() => Promise.resolve({ message_id: nextMsgId++ })),
    api: {
      editMessageText: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, subscriptionPlan: "free" },
    session,
    services: {
      userRepository: { getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "ru" }) },
      translationTemplateRepository: { getByUserId: vi.fn().mockResolvedValue(null) },
      contextLookup: vi.fn().mockResolvedValue([]),
      ai: { generateObject: vi.fn() },
    },
  } as unknown as BotContext;
}

describe("handleAltMeaningCallback — append-not-edit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the new sense as a NEW card and never edits the previous card in place", async () => {
    vi.mocked(translateWithContext).mockResolvedValue({ status: "accepted", output: acceptedOutput, quality });

    const ctx = createCtx();
    await handleAltMeaningCallback(ctx);

    // A new card was sent (loading message + the new card = 2 replies), and the
    // old card was NOT edited in place.
    expect(vi.mocked(ctx.reply).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(ctx.api.editMessageText).not.toHaveBeenCalled();
    expect(editMessageTextOrReply).not.toHaveBeenCalled();

    // A new session entry keyed by the new card id was created; the old entry
    // remains as a snapshot.
    const ids = Object.keys(ctx.session.translationMap ?? {});
    expect(ids).toContain(String(OLD_CARD_ID));
    expect(ids.length).toBe(2);
    const newId = ids.find((id) => id !== String(OLD_CARD_ID))!;
    expect(ctx.session.translationMap?.[newId]?.output.translations.ru?.text).toBe("перо");
    // pending pointers advanced to the new card.
    expect(ctx.session.pendingCardMsgId).toBe(Number(newId));
  });

  it("carries the previously-shown translations forward as negative constraints on the new card", async () => {
    vi.mocked(translateWithContext).mockResolvedValue({ status: "accepted", output: acceptedOutput, quality });

    const ctx = createCtx();
    await handleAltMeaningCallback(ctx);

    // The call to the pipeline excluded the already-shown sense…
    const callInput = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(callInput.negativeConstraints?.ru).toContain("но");

    // …and the new card entry carries that history forward for the next tap.
    const newId = Object.keys(ctx.session.translationMap ?? {}).find((id) => id !== String(OLD_CARD_ID))!;
    expect(ctx.session.translationMap?.[newId]?.previousTranslations?.ru).toContain("но");
  });

  it("leaves the previous card untouched and reports no-more-meanings on clarification", async () => {
    vi.mocked(translateWithContext).mockResolvedValue({
      status: "needs_clarification",
      ambiguity: { reason: "word_sense" },
    });

    const ctx = createCtx();
    await handleAltMeaningCallback(ctx);

    expect(ctx.api.editMessageText).not.toHaveBeenCalled();
    expect(Object.keys(ctx.session.translationMap ?? {})).toEqual([String(OLD_CARD_ID)]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: "[translationNoMoreMeanings]", show_alert: true }),
    );
  });
});
