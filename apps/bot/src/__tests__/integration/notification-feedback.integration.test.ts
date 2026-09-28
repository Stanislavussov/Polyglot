/**
 * Notification feedback — e2e (real dispatcher, real Postgres, fake `fetch`).
 *
 * A word notification is a card (Task 86): Reveal opens it as a Cards deck, rated with
 * the four SM-2 ratings, and Remove soft-deletes the entry. The Hard / OK / Easy grades
 * (`notif:fb:*`) are no longer sent, but the buttons already in chat history still land:
 * the grade is stored in `vocabulary_entries.difficulty`, which the single-word picker
 * weighs, and the old message is upgraded to the card's buttons. This file proves that
 * chain through the real middleware stack; the deck itself is `notification-deck`'s.
 *
 * **Assertion triad, adapted** (as in the delivery lane): a notification
 * callback has no session/FSM leg, so the third leg is the persisted
 * `difficulty` (or the soft-deleted entry), scoped to this test's own user.
 *
 * Only F1 enables notifications (it needs a real delivery); it pins itself to
 * the delivery lane's slot and unpins in `afterEach` via the same
 * disable-notifications drain. F2–F5 arrange with notifications OFF so they add
 * no cross-file noise to `checkAndSend`'s global scan.
 */
import { notificationRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { checkAndSend } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser, DELIVERY_TEST_SLOT_UTC } from "../../test-helpers/integration/arrange.js";
import type { CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { callbackQueryUpdate, createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const noLiveAi: GenerateObjectFn = async <T>(): Promise<T> => {
  throw new Error("NO_LIVE_AI_IN_TESTS: notification feedback flows never call a model");
};

/** Arrange a user whose entry the tests can grade, plus that entry's id. */
async function arrangeGradableUser(
  telegramId: number,
  options: { notificationEnabled?: boolean } = {},
): Promise<{ userId: number; entryId: number; headword: string }> {
  const { userId, headword } = await arrangeNotifiableUser(telegramId, {
    notificationEnabled: options.notificationEnabled ?? false,
  });
  const entries = await vocabularyRepository.findByUser(userId);
  const entryId = entries[0]?.id;
  if (entryId === undefined) throw new Error("arrangeGradableUser: expected a seeded vocabulary entry");
  return { userId, entryId, headword };
}

function answersOf(sent: CapturedCall[]): Array<{ text?: string; show_alert?: boolean }> {
  return sent
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => call.payload as { text?: string; show_alert?: boolean });
}

function markupEdits(sent: CapturedCall[]): string[][] {
  return sent
    .filter((call) => call.method === "editMessageReplyMarkup")
    .map((call) => {
      const markup = call.payload.reply_markup as
        | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
        | undefined;
      return (markup?.inline_keyboard ?? [])
        .flat()
        .map((b) => b.callback_data)
        .filter((d): d is string => typeof d === "string");
    });
}

/** Users F1 enabled notifications for — drained unconditionally, as in the delivery lane. */
const seededUserIds: number[] = [];

afterEach(async () => {
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("notification feedback (integration)", () => {
  it("F1: the delivered card carries the card's buttons, and a grade from an old nudge still lands and upgrades it", async () => {
    // Arrange — a real subscriber; the card must arrive through the real sendFn.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, entryId } = await arrangeGradableUser(telegramId, { notificationEnabled: true });
    seededUserIds.push(userId);
    const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, { generateObject: noLiveAi });
    harness.reset();

    // Act — deliver.
    await checkAndSend(sendFn, {
      ...deps,
      now: () => DELIVERY_TEST_SLOT_UTC,
      pickPresetWord: async () => null,
    });

    // Assert — the wire: this chat's card offers Reveal, Remove and the settings — no grade row.
    const card = harness.sent.find(
      (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === telegramId,
    );
    expect(card).toBeDefined();
    const markup = card?.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> };
    const cardButtons = [`notif:deck:${entryId}`, `notif:learned:${entryId}`, "notif:settings"];
    expect(markup.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(cardButtons);

    // Act — tap "Hard" on a nudge sent before notifications became cards.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 700, data: `notif:fb:hard:${entryId}` }),
    );

    // Assert — DB: the grade landed on the entry.
    const entries = await vocabularyRepository.findByUser(userId);
    expect(entries[0]?.difficulty).toBe("hard");

    // Assert — the wire: the old nudge now carries the card's buttons, and the toast confirms.
    expect(markupEdits(harness.sent).at(-1)).toEqual(cardButtons);
    const answers = answersOf(harness.sent);
    expect(answers).toHaveLength(1);
    expect(String(answers[0]?.text)).toContain("more often");
  });

  it("F2: re-grading from an old nudge overwrites — Hard then I-know-it ends at easy", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, entryId } = await arrangeGradableUser(telegramId);
    harness.reset();

    // Act — two taps on the same card.
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 701, data: `notif:fb:hard:${entryId}` }),
    );
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 701, data: `notif:fb:easy:${entryId}` }),
    );

    // Assert — DB holds the last word; the wire confirmed both taps.
    const entries = await vocabularyRepository.findByUser(userId);
    expect(entries[0]?.difficulty).toBe("easy");
    expect(answersOf(harness.sent)).toHaveLength(2);
  });

  it("F3: Remove soft-deletes the entry and confirms in the message", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, entryId, headword } = await arrangeGradableUser(telegramId);
    harness.reset();

    // Act
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: 702,
        data: `notif:learned:${entryId}`,
      }),
    );

    // Assert — DB: gone from the active dictionary.
    expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);

    // Assert — the wire: the message was replaced with the removal confirmation.
    const edited = harness.sent.find((call) => call.method === "editMessageText");
    expect(String((edited?.payload as { text?: string })?.text)).toContain(headword);
  });

  it("F4: a forged old-nudge grade cannot touch another user's entry", async () => {
    // Arrange — the owner's entry, and a separate onboarded stranger.
    const harness = createBotHarness();
    const ownerTelegramId = uniqueTelegramId();
    const strangerTelegramId = uniqueTelegramId();
    const { userId: ownerId, entryId } = await arrangeGradableUser(ownerTelegramId);
    await arrangeGradableUser(strangerTelegramId);
    harness.reset();

    // Act — the stranger taps a button forged against the owner's entry id.
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: strangerTelegramId,
        fromId: strangerTelegramId,
        messageId: 703,
        data: `notif:fb:hard:${entryId}`,
      }),
    );

    // Assert — the owner's grade is untouched, no keyboard was re-rendered, and
    // the stranger still got an answer (a silent drop would leave a spinner).
    const entries = await vocabularyRepository.findByUser(ownerId);
    expect(entries[0]?.difficulty).toBeNull();
    expect(markupEdits(harness.sent)).toHaveLength(0);
    expect(answersOf(harness.sent)).toHaveLength(1);
  });

  it("F5: an old nudge's grade on an already-removed entry answers without resurrecting anything", async () => {
    // Arrange — remove first, then tap a stale feedback button on the old card.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, entryId } = await arrangeGradableUser(telegramId);
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: 704,
        data: `notif:learned:${entryId}`,
      }),
    );
    harness.reset();

    // Act
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 704, data: `notif:fb:hard:${entryId}` }),
    );

    // Assert — still deleted, no keyboard edit, and the tap was answered.
    expect(await vocabularyRepository.findByUser(userId)).toHaveLength(0);
    expect(markupEdits(harness.sent)).toHaveLength(0);
    expect(answersOf(harness.sent)).toHaveLength(1);
  });
});
