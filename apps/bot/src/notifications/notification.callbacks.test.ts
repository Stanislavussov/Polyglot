/**
 * Tests for notification callback handlers (notif:reveal, notif:fb, notif:learned).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../renderers/dictionary.renderer.js", () => ({
  renderDictionaryEntry: vi.fn().mockReturnValue("<b>apple</b>\n🇷🇺 RU: <b>яблоко</b>"),
}));

vi.mock("./notification.formatter.js", () => ({
  buildNotificationRevealedKeyboard: vi.fn().mockReturnValue({
    inline_keyboard: [[{ text: "✅ Learned — remove", callback_data: "notif:learned:42" }]],
  }),
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
} from "./notification.callbacks.js";

const vocabularyRepository = {
  findById: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  setDifficulty: vi.fn().mockResolvedValue(true),
};

function createMockCtx(callbackData: string, messageReplyMarkup?: { inline_keyboard: unknown[][] }) {
  return {
    user: { id: 1 },
    from: { id: 12345 },
    callbackQuery: { data: callbackData, message: { message_id: 100, reply_markup: messageReplyMarkup } },
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

describe("handleNotifRevealCallback", () => {
  it("renders full dictionary entry and updates message", async () => {
    const ctx = createMockCtx("notif:reveal:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue({
      id: 42,
      userId: 1,
      original: "apple",
      emoji: "🍎",
      nativeMeaning: null,
      sourceLangId: 1,
      inputType: "word",
      isActive: true,
      sourceUsage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      translations: [],
    } as any);

    await handleNotifRevealCallback(ctx);

    expect(vocabularyRepository.findById).toHaveBeenCalledWith(42);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("keeps a previously stored grade marked on the revealed keyboard", async () => {
    const { buildNotificationRevealedKeyboard } = await import("./notification.formatter.js");
    const ctx = createMockCtx("notif:reveal:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue({
      id: 42,
      original: "apple",
      difficulty: "hard",
      translations: [],
    } as any);

    await handleNotifRevealCallback(ctx);

    expect(vi.mocked(buildNotificationRevealedKeyboard)).toHaveBeenCalledWith("en", 42, "hard");
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
    vi.mocked(vocabularyRepository.findById).mockResolvedValue({ id: 42, original: "apple" } as any);

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
        }) as any,
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

describe("handleNotifFeedbackCallback", () => {
  it("persists the grade and confirms with a toast", async () => {
    const ctx = createMockCtx("notif:fb:hard:42");
    vi.mocked(vocabularyRepository.setDifficulty).mockResolvedValue(true);

    await handleNotifFeedbackCallback(ctx);

    expect(vocabularyRepository.setDifficulty).toHaveBeenCalledWith(42, 1, "hard");
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: expect.stringContaining("more often") });
  });

  it("re-renders the initial keyboard variant when the message still shows Reveal", async () => {
    const { buildNotificationKeyboard, buildNotificationRevealedKeyboard } = await import(
      "./notification.formatter.js"
    );
    const withReveal = { inline_keyboard: [[{ text: "🔍", callback_data: "notif:reveal:42" }]] };
    const ctx = createMockCtx("notif:fb:easy:42", withReveal);

    await handleNotifFeedbackCallback(ctx);

    expect(vi.mocked(buildNotificationKeyboard)).toHaveBeenCalledWith("en", 42, "easy");
    expect(vi.mocked(buildNotificationRevealedKeyboard)).not.toHaveBeenCalled();
  });

  it("re-renders the revealed keyboard variant when Reveal is gone", async () => {
    const { buildNotificationRevealedKeyboard } = await import("./notification.formatter.js");
    const revealed = { inline_keyboard: [[{ text: "😅", callback_data: "notif:fb:hard:42" }]] };
    const ctx = createMockCtx("notif:fb:normal:42", revealed);

    await handleNotifFeedbackCallback(ctx);

    expect(vi.mocked(buildNotificationRevealedKeyboard)).toHaveBeenCalledWith("en", 42, "normal");
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
