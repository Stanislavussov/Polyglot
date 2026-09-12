/**
 * Tests for notification callback handlers (notif:reveal, notif:fb, notif:learned).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Reveal opens the translation card, so the card's own renderer and keyboard are
// the collaborators here — the handler's job is to feed them the saved entry and
// to leave the session entry their buttons address.
vi.mock("../renderers/translation.renderer.js", () => ({
  renderTranslation: vi.fn().mockReturnValue("🍎 🇬🇧 <b>apple</b>\n🇷🇺 RU: <b>яблоко</b>"),
  buildTranslationKeyboard: vi.fn().mockReturnValue({
    inline_keyboard: [[{ text: "🎯 Clarify", callback_data: "tr:clarifypost:100" }]],
  }),
}));

vi.mock("../scenes/helpers/translate-mode.shared.js", () => ({
  isEtymologyEligible: vi.fn().mockReturnValue(false),
  resolvePronounceLangs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../scenes/helpers/paid-feature.helper.js", () => ({
  resolveLockedBadges: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../scenes/helpers/translate-flow.js", () => ({
  handleTranslateText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./notification.formatter.js", () => ({
  buildNotificationKeyboard: vi.fn().mockReturnValue({
    inline_keyboard: [[{ text: "👀 Show translation", callback_data: "notif:reveal:42" }]],
  }),
}));

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../test-helpers/services-stub.js";
import {
  handleNotifFeedbackCallback,
  handleNotifLearnedCallback,
  handleNotifRevealCallback,
  handleNotifTranslateCallback,
} from "./notification.callbacks.js";

const vocabularyRepository = {
  findById: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  setDifficulty: vi.fn().mockResolvedValue(true),
};

function createMockCtx(
  callbackData: string,
  messageReplyMarkup?: { inline_keyboard: unknown[][] },
  message?: { text?: string; entities?: Array<{ type: string; offset: number; length: number }> },
) {
  return {
    user: { id: 1, subscriptionPlan: "free" },
    from: { id: 12345 },
    chat: { id: 12345 },
    session: {},
    api: { editMessageReplyMarkup: vi.fn().mockResolvedValue({}) },
    callbackQuery: {
      data: callbackData,
      message: { message_id: 100, reply_markup: messageReplyMarkup, ...message },
    },
    services: createServicesStub({
      vocabularyRepository: vocabularyRepository as unknown as ServiceContainer["vocabularyRepository"],
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
      } as unknown as ServiceContainer["userRepository"],
      languageCache: {
        getAllLangs: () => [
          { id: 1, code: "en" },
          { id: 2, code: "cs" },
          { id: 3, code: "ru" },
        ],
      } as unknown as ServiceContainer["languageCache"],
    }),
    editMessageText: vi.fn().mockResolvedValue({}),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` drops recorded calls but keeps implementations, so the cases
  // below that make a repository answer "not saved" or throw would leak that
  // answer into whichever test the runner happens to place next — which is a
  // silent pass until the day the order changes. Re-establish the happy path.
  vocabularyRepository.findById.mockReset();
  vocabularyRepository.setDifficulty.mockResolvedValue(true);
  vocabularyRepository.delete.mockResolvedValue(undefined);
});

/** A saved entry as `findById` returns it, with one resolvable translation. */
function savedEntry(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    userId: 1,
    original: "apple",
    emoji: "🍎",
    nativeMeaning: null,
    sourceLangId: 1,
    inputType: "word",
    isActive: true,
    sourceUsage: null,
    unverified: false,
    difficulty: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    translations: [
      {
        id: 1,
        entryId: 42,
        targetLangId: 3,
        text: "яблоко",
        expressionType: null,
        equivalentNote: null,
        usageNote: null,
        connotationWarning: null,
        details: null,
      },
    ],
    ...over,
  };
}

describe("handleNotifRevealCallback", () => {
  it("replaces the nudge with the translation card and its own keyboard", async () => {
    const { buildTranslationKeyboard } = await import("../renderers/translation.renderer.js");
    const ctx = createMockCtx("notif:reveal:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue(savedEntry() as never);

    await handleNotifRevealCallback(ctx);

    expect(vocabularyRepository.findById).toHaveBeenCalledWith(42);
    expect(ctx.editMessageText).toHaveBeenCalled();
    // The word is in the dictionary already — the card must say so, not offer to
    // save it a second time.
    expect(vi.mocked(buildTranslationKeyboard)).toHaveBeenCalledWith(
      expect.objectContaining({ msgId: 100, isAlreadySaved: true }),
    );
    expect(ctx.api.editMessageReplyMarkup).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("leaves the session entry the card's buttons address", async () => {
    // Clarify, another meaning, pronounce and save all look their card up by
    // message id. Without this entry the card would render with dead buttons.
    const ctx = createMockCtx("notif:reveal:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue(savedEntry() as never);

    await handleNotifRevealCallback(ctx);

    const entry = ctx.session.translationMap?.["100"];
    expect(entry?.output.original).toBe("apple");
    expect(entry?.output.translations.ru?.text).toBe("яблоко");
    expect(entry?.savedWordId).toBe(42);
    expect(ctx.session.pendingCardMsgId).toBe(100);
  });

  it("handles missing entry gracefully", async () => {
    const ctx = createMockCtx("notif:reveal:999");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue(null);

    await handleNotifRevealCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("handles invalid entryId gracefully", async () => {
    const ctx = createMockCtx("notif:reveal:");

    await handleNotifRevealCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(vocabularyRepository.findById).not.toHaveBeenCalled();
  });

  it("shows a persistent loading button on the notification while the card loads", async () => {
    const ctx = createMockCtx("notif:reveal:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue(savedEntry() as never);

    await handleNotifRevealCallback(ctx);

    const firstMarkup = ctx.editMessageReplyMarkup.mock.calls[0]?.[0]?.reply_markup;
    expect(firstMarkup?.inline_keyboard?.[0]?.[0]).toMatchObject({ callback_data: "noop" });
  });

  it("restores the buttons and tells the user when loading takes too long", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createMockCtx("notif:reveal:42");
      vi.mocked(vocabularyRepository.findById).mockReturnValue(
        new Promise(() => {
          /* Neon never answers */
        }) as never,
      );

      const flow = handleNotifRevealCallback(ctx);
      await vi.advanceTimersByTimeAsync(20_000);
      await flow;

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ show_alert: true, text: expect.stringContaining("⌛") }),
      );
      const lastMarkup = ctx.editMessageReplyMarkup.mock.calls.at(-1)?.[0]?.reply_markup;
      expect(lastMarkup?.inline_keyboard?.[0]?.[0]).toMatchObject({ callback_data: "notif:reveal:42" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleNotifTranslateCallback", () => {
  /**
   * The nudge as Telegram delivers it back: plain text plus the bold span.
   *
   * The offset is computed, not written down — Telegram counts UTF-16 code units,
   * so the two emoji ahead of the word are worth six of them, and a hand-counted
   * offset silently slices the wrong substring.
   */
  const NUDGE_TEXT = "📄 🇩🇪 Kündigung\n\nCheck yourself — do you remember the translation?";
  const nudge = {
    text: NUDGE_TEXT,
    entities: [{ type: "bold", offset: NUDGE_TEXT.indexOf("Kündigung"), length: "Kündigung".length }],
  };

  it("translates the word the nudge showed", async () => {
    const { handleTranslateText } = await import("../scenes/helpers/translate-flow.js");
    const ctx = createMockCtx("notif:tr", undefined, nudge);

    await handleNotifTranslateCallback(ctx);

    expect(vi.mocked(handleTranslateText)).toHaveBeenCalledWith(ctx, "Kündigung");
  });

  it("drops the button first, so a second tap cannot bill a second translation", async () => {
    const ctx = createMockCtx("notif:tr", undefined, nudge);

    await handleNotifTranslateCallback(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: { inline_keyboard: [] } });
  });

  it("does nothing when the message has no word to read", async () => {
    const { handleTranslateText } = await import("../scenes/helpers/translate-flow.js");
    const ctx = createMockCtx("notif:tr");

    await handleNotifTranslateCallback(ctx);

    expect(vi.mocked(handleTranslateText)).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});

describe("handleNotifFeedbackCallback", () => {
  it("persists the grade and confirms with a toast", async () => {
    const ctx = createMockCtx("notif:fb:hard:42");
    vi.mocked(vocabularyRepository.setDifficulty).mockResolvedValue(true);

    await handleNotifFeedbackCallback(ctx);

    expect(vocabularyRepository.setDifficulty).toHaveBeenCalledWith(42, 1, "hard");
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: expect.stringContaining("more often") });
  });

  it("marks the chosen grade on the nudge's own keyboard", async () => {
    // The grades live on the nudge only — a revealed card carries the translation
    // keyboard — so there is one keyboard to re-render.
    const { buildNotificationKeyboard } = await import("./notification.formatter.js");
    const withReveal = { inline_keyboard: [[{ text: "🔍", callback_data: "notif:reveal:42" }]] };
    const ctx = createMockCtx("notif:fb:easy:42", withReveal);

    await handleNotifFeedbackCallback(ctx);

    expect(vi.mocked(buildNotificationKeyboard)).toHaveBeenCalledWith("en", 42, "easy");
  });

  it("tells the user when the entry no longer exists instead of editing the keyboard", async () => {
    const ctx = createMockCtx("notif:fb:hard:999");
    vi.mocked(vocabularyRepository.setDifficulty).mockResolvedValue(false);

    await handleNotifFeedbackCallback(ctx);

    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: expect.any(String) });
  });

  it("ignores a malformed grade without touching the repository", async () => {
    const ctx = createMockCtx("notif:fb:bogus:42");

    await handleNotifFeedbackCallback(ctx);

    expect(vocabularyRepository.setDifficulty).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("alerts on a persistence failure", async () => {
    const ctx = createMockCtx("notif:fb:hard:42");
    vi.mocked(vocabularyRepository.setDifficulty).mockRejectedValue(new Error("db down"));

    await handleNotifFeedbackCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe("handleNotifLearnedCallback", () => {
  it("soft-deletes entry and shows confirmation", async () => {
    const ctx = createMockCtx("notif:learned:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue({
      id: 42,
      original: "apple",
    } as any);

    await handleNotifLearnedCallback(ctx);

    expect(vocabularyRepository.delete).toHaveBeenCalledWith(42, 1);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("handles invalid entryId gracefully", async () => {
    const ctx = createMockCtx("notif:learned:");

    await handleNotifLearnedCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(vocabularyRepository.delete).not.toHaveBeenCalled();
  });
});
