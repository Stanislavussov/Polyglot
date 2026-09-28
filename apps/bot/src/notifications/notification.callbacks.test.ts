/**
 * Tests for notification callback handlers (notif:tr, notif:fb, notif:learned, notif:restore).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../scenes/helpers/translate-flow.js", () => ({
  handleTranslateText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./notification.formatter.js", () => ({
  buildNotificationKeyboard: vi.fn().mockReturnValue({
    inline_keyboard: [[{ text: "👀 Show translation", callback_data: "notif:reveal:42" }]],
  }),
  buildNotificationRestoreKeyboard: vi.fn().mockReturnValue({
    inline_keyboard: [[{ text: "↩️ Bring the removed word back", callback_data: "notif:restore:42" }]],
  }),
}));

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../test-helpers/services-stub.js";
import { LONG_OP_TIMEOUT_MS } from "../utils/long-op.js";
import {
  handleNotifDeckCallback,
  handleNotifFeedbackCallback,
  handleNotifLearnedCallback,
  handleNotifTranslateCallback,
} from "./notification.callbacks.js";

const vocabularyRepository = {
  findById: vi.fn(),
  delete: vi.fn().mockResolvedValue(true),
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
  vocabularyRepository.delete.mockResolvedValue(true);
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

  it("upgrades an old nudge to the card's buttons, so it offers the four ratings from here on", async () => {
    const { buildNotificationKeyboard } = await import("./notification.formatter.js");
    const withReveal = { inline_keyboard: [[{ text: "🔍", callback_data: "notif:reveal:42" }]] };
    const ctx = createMockCtx("notif:fb:easy:42", withReveal);

    await handleNotifFeedbackCallback(ctx);

    expect(vi.mocked(buildNotificationKeyboard)).toHaveBeenCalledWith("en", 42);
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
  });

  it("saves a grade tapped on a revealed card without swapping the card's buttons", async () => {
    const { buildNotificationKeyboard } = await import("./notification.formatter.js");
    const cardMarkup = { inline_keyboard: [[{ text: "⋯", callback_data: "tr:more:100" }]] };
    const ctx = createMockCtx("notif:fb:easy:42", cardMarkup);

    await handleNotifFeedbackCallback(ctx);

    expect(vocabularyRepository.setDifficulty).toHaveBeenCalledWith(42, 1, "easy");
    expect(vi.mocked(buildNotificationKeyboard)).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: expect.any(String) });
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

  it("answers without a removal confirmation when the word was already removed", async () => {
    const ctx = createMockCtx("notif:learned:42");
    vocabularyRepository.delete.mockResolvedValue(false);

    await handleNotifLearnedCallback(ctx);

    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("handles invalid entryId gracefully", async () => {
    const ctx = createMockCtx("notif:learned:");

    await handleNotifLearnedCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(vocabularyRepository.delete).not.toHaveBeenCalled();
  });
});

describe("handleNotifDeckCallback", () => {
  it("leaves a running /review deck alone when the notification fails to open", async () => {
    const runningDeck = { deck: [], currentIndex: 2, revealed: true, recalled: 1 };
    const ctx = createMockCtx("notif:deck:42");
    ctx.session.cards = runningDeck;
    ctx.match = ["notif:deck:42", "42"];
    ctx.services.userRepository.getSettings = vi.fn().mockRejectedValue(new Error("db down"));

    await handleNotifDeckCallback(ctx);

    expect(ctx.session.cards).toBe(runningDeck);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});
