/**
 * Tests for notification callback handlers (notif:reveal, notif:learned).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@polyglot/adapter-db", () => ({
  getAllLangs: () => [
    { id: 1, code: "en" },
    { id: 2, code: "cs" },
    { id: 3, code: "ru" },
  ],
  vocabularyRepository: {
    findById: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  userRepository: {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
  },
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

import { vocabularyRepository } from "@polyglot/adapter-db";
import { handleNotifLearnedCallback, handleNotifRevealCallback } from "./notification.callbacks.js";

function createMockCtx(callbackData: string) {
  return {
    user: { id: 1 },
    from: { id: 12345 },
    callbackQuery: { data: callbackData, message: { message_id: 100 } },
    editMessageText: vi.fn().mockResolvedValue({}),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("handleNotifLearnedCallback", () => {
  it("soft-deletes entry and shows confirmation", async () => {
    const ctx = createMockCtx("notif:learned:42");
    vi.mocked(vocabularyRepository.findById).mockResolvedValue({
      id: 42,
      original: "apple",
    } as any);

    await handleNotifLearnedCallback(ctx);

    expect(vocabularyRepository.delete).toHaveBeenCalledWith(42);
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
