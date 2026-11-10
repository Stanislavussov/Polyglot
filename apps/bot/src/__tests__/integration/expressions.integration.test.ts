/**
 * Expressions — e2e (real dispatcher, real Postgres, fake `fetch`).
 *
 * Two routes into one card: the scheduled notification of a subscriber who chose
 * the `expressions` type, and the Learn hub's 💬 button with its "another one".
 * Only the AI boundary is a fixture, and it is asserted on, never just stubbed.
 *
 * The scheduled half uses its own 11:00 UTC slot: `checkAndSend` scans the whole
 * table, and an expressions subscriber on another file's slot would reach that
 * file's AI tripwire.
 */
import {
  notificationDeliveryRepository,
  notificationRepository,
  translationRequestRepository,
} from "@polyglot/adapter-db";
import { checkAndSend } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn, GenerateOptions } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser, arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const EXPRESSION_SLOT_UTC = { hour: 11, minute: 0 } as const;
const EXPRESSION_SLOT_TIME = "11:00";

const GOLDFISH = {
  expression: "Be a goldfish",
  meaning: "Forget a mistake quickly and move on.",
  sourceKind: "series",
  sourceTitle: "Ted Lasso",
  example: "Missed the penalty? Be a goldfish.",
};

interface RecordedAi {
  fn: GenerateObjectFn;
  calls: Array<{ prompt: string; options: GenerateOptions | undefined }>;
}

/** Answers only an expression-shaped schema; anything else is an unexpected AI call and throws. */
function expressionAi(reply: Record<string, unknown> = GOLDFISH): RecordedAi {
  const calls: RecordedAi["calls"] = [];
  const fn: GenerateObjectFn = async (prompt, schema, _model, options) => {
    calls.push({ prompt, options });
    const parsed = schema.safeParse(reply);
    if (!parsed.success) throw new Error("NO_LIVE_AI_IN_TESTS: an unexpected AI call was reached");
    return parsed.data;
  };
  return { fn, calls };
}

function failingAi(): RecordedAi {
  const calls: RecordedAi["calls"] = [];
  const fn: GenerateObjectFn = async (prompt, _schema, _model, options) => {
    calls.push({ prompt, options });
    throw new Error("model down");
  };
  return { fn, calls };
}

function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

function textOf(call: CapturedCall | undefined): string {
  return String((call?.payload as { text?: string } | undefined)?.text ?? "");
}

function buttonsOf(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** The learner's real route: /menu → 🎓 Learning → 💬 Expressions. */
async function openExpressions(harness: BotHarness, id: number): Promise<void> {
  await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/menu" }));
  const menu = harness.sent.find((call) => call.method === "sendMessage" && buttonsOf(call).includes("menu:learn"));
  if (!menu) throw new Error("/menu sent no menu");
  const menuId = menu.messageId ?? 1;
  await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "menu:learn" }));
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId: menuId, data: "lrn:expr" }));
}

const subscribers: number[] = [];

afterEach(async () => {
  const ids = subscribers.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("expressions (integration)", () => {
  it("sends an expressions subscriber an expression card instead of a word", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeNotifiableUser(telegramId, { notificationTimes: [EXPRESSION_SLOT_TIME] });
    subscribers.push(userId);
    await notificationRepository.updatePrefs(userId, { notificationType: "expressions" });
    const ai = expressionAi();
    const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: ai.fn,
      pickSelfCheckVariant: () => 0,
    });

    // Act
    await checkAndSend(sendFn, {
      ...deps,
      now: () => EXPRESSION_SLOT_UTC,
      pickPresetWord: async () => null,
      pickPackWord: async () => null,
    });

    // Assert — reply
    const [message, ...extra] = messagesTo(harness.sent, telegramId);
    expect(extra).toHaveLength(0);
    expect(textOf(message)).toContain("<b>Be a goldfish</b>");
    expect(textOf(message)).toContain("Ted Lasso");
    expect(textOf(message)).not.toContain(headword);
    expect(buttonsOf(message)).toEqual(["notif:tr", "notif:settings"]);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.options).toMatchObject({ userId, temperature: expect.any(Number) });

    // Assert — persisted state: the de-dup ledger and the admin journal
    const since = new Date(Date.now() - 60 * 60 * 1000);
    expect(await notificationRepository.getSentWordsFromSourceSince(userId, "expressions", since)).toEqual([
      "Be a goldfish",
    ]);
    const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 5, userId });
    expect(deliveries[0]).toMatchObject({ kind: "expression" });
  });

  it("falls back to a dictionary word when the expression cannot be generated", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeNotifiableUser(telegramId, { notificationTimes: [EXPRESSION_SLOT_TIME] });
    subscribers.push(userId);
    await notificationRepository.updatePrefs(userId, { notificationType: "expressions" });
    const ai = failingAi();
    const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: ai.fn,
      pickSelfCheckVariant: () => 0,
    });

    // Act
    await checkAndSend(sendFn, {
      ...deps,
      now: () => EXPRESSION_SLOT_UTC,
      pickPresetWord: async () => null,
      pickPackWord: async () => null,
    });

    // Assert
    const [message] = messagesTo(harness.sent, telegramId);
    expect(textOf(message)).toContain(headword);
    expect(ai.calls.length).toBeGreaterThan(0);
    const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 5, userId });
    expect(deliveries[0]).toMatchObject({ kind: "word_card" });
  });

  it("serves expressions on demand from the Learn hub and bills each one", async () => {
    // Arrange
    const ai = expressionAi();
    const harness = createBotHarness({ ai: { generateObject: ai.fn } });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { nativeLang: "ru", learningLangs: ["en"] });
    const before = await translationRequestRepository.getUserCreditsInWindow(userId, new Date(0));

    // Act 1 — the hub button
    await openExpressions(harness, id);

    // Assert — reply, AI, billing
    const card = messagesTo(harness.sent, id).find((call) => buttonsOf(call).includes("expr:more"));
    if (!card) throw new Error("the expression card was never sent");
    expect(textOf(card)).toContain("<b>Be a goldfish</b>");
    expect(buttonsOf(card)).toEqual(["notif:tr", "expr:more"]);
    expect(ai.calls).toHaveLength(1);
    expect(await translationRequestRepository.getUserCreditsInWindow(userId, new Date(0))).toBeGreaterThan(before);

    // Act 2 — "another one"
    harness.reset();
    const cardId = card.messageId ?? 1;
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: id,
        fromId: id,
        messageId: cardId,
        data: "expr:more",
        messageText: "🎭 🇬🇧 Be a goldfish",
        messageEntities: [{ type: "bold", offset: "🎭 🇬🇧 ".length, length: "Be a goldfish".length }],
        messageReplyMarkup: card.payload.reply_markup as InlineKeyboardMarkup,
      }),
    );

    // Assert — the old card keeps only save, a new card arrives, the shown one is avoided
    const edit = harness.sent.find((call) => call.method === "editMessageReplyMarkup");
    expect(buttonsOf(edit)).toEqual(["notif:tr"]);
    expect(messagesTo(harness.sent, id).some((call) => buttonsOf(call).includes("expr:more"))).toBe(true);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]?.prompt).toContain("Be a goldfish");
  });

  it("tells the learner when no expression could be found", async () => {
    // Arrange
    const ai = failingAi();
    const harness = createBotHarness({ ai: { generateObject: ai.fn } });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // Act
    await openExpressions(harness, id);

    // Assert
    expect(ai.calls).toHaveLength(1);
    const texts = messagesTo(harness.sent, id).map(textOf);
    expect(texts).toContain("Couldn't find an expression this time. Please try again.");
    expect(messagesTo(harness.sent, id).some((call) => buttonsOf(call).includes("expr:more"))).toBe(false);
  });
});
