import { t, type UserLanguageSettings } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middlewares/request-settings.js", () => ({ getRequestSettings: vi.fn() }));

import { getRequestSettings } from "../../middlewares/request-settings.js";
import type { BotContext, SessionData } from "../../types.js";
import { RETRY_CALLBACK } from "../../utils/retry-action.js";
import { answerStaleCallback } from "./stale-callback.helper.js";
import { setTranslationEntry } from "./translation-map.helper.js";

const CARD_MSG_ID = 4242;
const NOTICE_MSG_ID = 4243;

function cardEntry(word: string, contextHint?: string): NonNullable<SessionData["translationMap"]>[string] {
  return {
    output: { sourceLang: "de", original: word } as NonNullable<SessionData["translationMap"]>[string]["output"],
    inputType: "word",
    ...(contextHint !== undefined && { contextHint }),
  };
}

/** Only `interfaceLang` matters here; the rest satisfies the port's shape. */
function settingsWithInterfaceLang(interfaceLang: string): UserLanguageSettings {
  return {
    id: 1,
    userId: 1,
    interfaceLang,
    nativeLang: "ru",
    learningLangs: ["de"],
    timezone: "UTC",
    activeMode: "translate",
    lastSourceLang: null,
    notificationEnabled: false,
    notificationTimes: [],
    notificationType: "word",
    notificationContext: null,
    lastInteractionAt: null,
    isActive: true,
    updatedAt: new Date(0),
  };
}

function createMockCtx(): BotContext & { session: SessionData } {
  return {
    session: { activeMode: "translate" } as SessionData,
    user: { id: 1, telegramId: 99, onboarded: true, subscriptionPlan: "free" },
    callbackQuery: { data: `tr:save:${CARD_MSG_ID}`, message: { message_id: CARD_MSG_ID } },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue({ message_id: NOTICE_MSG_ID }),
    services: {},
  } as unknown as BotContext & { session: SessionData };
}

/** The text of the chat notice, or undefined when no notice was sent. */
function noticeText(ctx: BotContext): string | undefined {
  const call = vi.mocked(ctx.reply).mock.calls[0];
  return call?.[0];
}

describe("answerStaleCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequestSettings).mockResolvedValue(settingsWithInterfaceLang("ru"));
  });

  it("answers in the user's interface language, not English", async () => {
    const ctx = createMockCtx();

    await answerStaleCallback(ctx, { action: "tr:save" });

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("staleSession", "ru"), show_alert: true });
    expect(t("staleSession", "ru")).not.toBe(t("staleSession", "en"));
  });

  it("offers a one-tap re-translate for a card whose state was evicted", async () => {
    const ctx = createMockCtx();
    // The card's full state is gone, but the input behind it is still known.
    setTranslationEntry(ctx.session, CARD_MSG_ID, cardEntry("Arbeit"), 1);
    setTranslationEntry(ctx.session, CARD_MSG_ID + 1, cardEntry("Haus"), 1);

    await answerStaleCallback(ctx, { action: "tr:save", msgId: CARD_MSG_ID });

    expect(noticeText(ctx)).toBe(t("staleCardRetryPrompt", "ru", { word: "Arbeit" }));
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[1]).toMatchObject({
      reply_markup: { inline_keyboard: [[{ text: t("retryButton", "ru"), callback_data: RETRY_CALLBACK }]] },
    });
    expect(ctx.session.pendingRetries?.[String(NOTICE_MSG_ID)]).toMatchObject({
      kind: "translate",
      text: "Arbeit",
    });
  });

  it("round-trips the card's context hint into the retry input", async () => {
    const ctx = createMockCtx();
    setTranslationEntry(ctx.session, CARD_MSG_ID, cardEntry("bank", "river"), 1);
    setTranslationEntry(ctx.session, CARD_MSG_ID + 1, cardEntry("Haus"), 1);

    await answerStaleCallback(ctx, { action: "tr:save", msgId: CARD_MSG_ID });

    expect(ctx.session.pendingRetries?.[String(NOTICE_MSG_ID)]?.text).toBe("bank :: river");
  });

  it("uses an explicitly supplied input when the guard is not card-backed", async () => {
    const ctx = createMockCtx();

    await answerStaleCallback(ctx, { action: "tr:langselect", word: "Haus" });

    expect(noticeText(ctx)).toBe(t("staleCardRetryPrompt", "ru", { word: "Haus" }));
  });

  it("stops at the alert when nothing about the tap is recoverable", async () => {
    const ctx = createMockCtx();

    await answerStaleCallback(ctx, { action: "retry", msgId: 999999 });

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("still answers the tap when the settings lookup fails", async () => {
    // This runs on a handler's failure path — a second failure here would leave
    // the button spinning with no message at all.
    const ctx = createMockCtx();
    vi.mocked(getRequestSettings).mockRejectedValue(new Error("db down"));

    await answerStaleCallback(ctx, { action: "tr:save" });

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("staleSession", "en"), show_alert: true });
  });
});
