/**
 * Several cards per notification — e2e (scheduler → delivery → callbacks, real Postgres, fake `fetch`), Task 86.
 *
 * @business A reader who asked for N cards per notification gets one message that opens into
 * the `/review` deck: every rating has to leave the evidence Cards leaves (SM-2 schedule,
 * review log) and move on to the next card inside the same message. Every notification also
 * offers the notification settings, so switching them off or down never needs a menu hunt.
 *
 * **Its own UTC slot (17:00).** `checkAndSend` scans the whole table: `notification-delivery`
 * owns 13:00, `notification-weekly-line` 15:00 and the persistence lane 08:00, so a batch here
 * reaches only this file's subscribers.
 *
 * Assertion triad: the wire (the delivered message, the screens it turns into), the persisted
 * rows (`notification_history`, SRS columns, `word_review_log`, the batch-size column), and
 * the session's `cards` deck.
 */
import {
  botSessionRepository,
  getDb,
  getLang,
  notificationRepository,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import { checkAndSend, type NotificationPayload, type SchedulerDeps } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import type { SessionData } from "../../types.js";

const DECK_SLOT_UTC = { hour: 17, minute: 0 } as const;
const DECK_SLOT_TIME = "17:00";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAST = new Date("2020-01-01T00:00:00.000Z").getTime();

/** Overdue by a different amount each, so the deck order is the seeding order. */
const WORDS = ["pes", "kočka", "dům", "strom"] as const;

function langId(code: string): number {
  const lang = getLang(code);
  if (!lang) throw new Error(`language cache is not loaded (${code} missing)`);
  return lang.id;
}

interface Seeded {
  entryId: number;
  translationId: number;
}

async function seedDueWords(userId: number): Promise<Record<(typeof WORDS)[number], Seeded>> {
  const seeded = {} as Record<(typeof WORDS)[number], Seeded>;
  for (const [index, original] of WORDS.entries()) {
    const entry = await vocabularyRepository.create(userId, {
      original,
      sourceLangId: langId("cs"),
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: langId("en"), text: `${original}-en`, details: { synonyms: [], examples: [] } }],
    });
    const translationId = entry.translations[0]!.id;
    await vocabularyRepository.updateSrsState(translationId, {
      easeFactor: 2.5,
      interval: 1,
      dueDate: new Date(PAST + index * DAY_MS),
      reviewCount: 1,
    });
    seeded[original] = { entryId: entry.id, translationId };
  }
  return seeded;
}

/** Records that a just-in-time AI call was reached, then fails — a throw alone is swallowed by the pickers. */
function createAiTripwire(): { fn: GenerateObjectFn; wasCalled: () => boolean } {
  let called = false;
  const fn: GenerateObjectFn = async <T>(): Promise<T> => {
    called = true;
    throw new Error("NO_LIVE_AI_IN_TESTS");
  };
  return { fn, wasCalled: () => called };
}

async function buildDelivery(harness: BotHarness): Promise<{
  sendFn: (userId: number, payload: NotificationPayload) => Promise<void>;
  deps: SchedulerDeps;
  ai: ReturnType<typeof createAiTripwire>;
}> {
  const ai = createAiTripwire();
  const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
    generateObject: ai.fn,
    pickSelfCheckVariant: () => 0,
  });
  return { sendFn, ai, deps: { ...deps, now: () => DECK_SLOT_UTC, pickPresetWord: async () => null } };
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

function textOf(call: CapturedCall | undefined): string {
  return String((call?.payload as { text?: string } | undefined)?.text ?? "");
}

function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

function lastScreen(sent: CapturedCall[]): CapturedCall | undefined {
  return sent.filter((call) => call.method === "sendMessage" || call.method === "editMessageText").at(-1);
}

async function readSession(chatId: number): Promise<SessionData | undefined> {
  return (await botSessionRepository.get(String(chatId)))?.data as SessionData | undefined;
}

async function tap(harness: BotHarness, chatId: number, messageId: number, data: string): Promise<void> {
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));
}

/** `drizzle-orm` is not a dependency of `apps/bot`; the log is read through the adapter's driver. */
async function reviewLog(entryId: number): Promise<string[]> {
  const rows = await getDb().$client<Array<{ session_type: string }>>`
    select session_type from word_review_log where entry_id = ${entryId}
  `;
  return rows.map((row) => row.session_type);
}

const seededUserIds: number[] = [];

async function arrangeSubscriber(telegramId: number, batchSize: number): Promise<number> {
  const { userId } = await arrangeNotifiableUser(telegramId, {
    notificationTimes: [DECK_SLOT_TIME],
    withVocabulary: false,
  });
  seededUserIds.push(userId);
  await notificationRepository.updatePrefs(userId, { notificationBatchSize: batchSize });
  return userId;
}

/** Deliver this slot's batch and return the one message this chat received. */
async function deliver(harness: BotHarness, telegramId: number): Promise<CapturedCall> {
  const { sendFn, deps, ai } = await buildDelivery(harness);
  harness.reset();
  await checkAndSend(sendFn, deps);
  const mine = messagesTo(harness.sent, telegramId);
  expect(mine).toHaveLength(1);
  expect(ai.wasCalled()).toBe(false);
  return mine[0]!;
}

afterEach(async () => {
  // Unconditional: a test failing midway must not leave a subscriber pinned to this slot.
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("several cards per notification (integration)", () => {
  it("D1: sends one message that brings the user's number of cards, most overdue first", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 3);
    const words = await seedDueWords(userId);
    const since = new Date(Date.now() - HOUR_MS);

    // Act
    const delivered = await deliver(harness, telegramId);

    // Assert — the wire: the count, the first card, Show answer on it, the settings.
    expect(textOf(delivered)).toContain("🃏 Cards to review: 3");
    expect(textOf(delivered)).toContain("pes");
    expect(buttonsOf(delivered)).toEqual([
      `notif:deck:${words.pes.entryId}`,
      `notif:learned:${words.pes.entryId}`,
      "notif:settings",
    ]);
    // Assert — every card the message carried is in the de-dup history.
    expect((await notificationRepository.getSentWordsSince(userId, since)).sort()).toEqual(
      ["dům", "kočka", "pes"].sort(),
    );
  });

  it("D2: Show answer opens the deck in the same message, and a rating schedules the word and moves on", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 3);
    const words = await seedDueWords(userId);
    const delivered = await deliver(harness, telegramId);
    const messageId = delivered.messageId!;

    // Act — Show answer.
    await tap(harness, telegramId, messageId, `notif:deck:${words.pes.entryId}`);

    // Assert — the notification became the revealed card with the four SM-2 ratings.
    const back = lastScreen(harness.sent);
    expect(back?.method).toBe("editMessageText");
    expect((back?.payload as { message_id?: number }).message_id).toBe(messageId);
    expect(textOf(back)).toContain("Card 1 of 3");
    expect(buttonsOf(back)).toContain(`fc:rate:good:${words.pes.translationId}`);
    const session = await readSession(telegramId);
    expect(session?.cards?.deck.map((card) => card.original)).toEqual(["pes", "kočka", "dům"]);
    expect(session?.cards?.revealed).toBe(true);

    // Act — rate it.
    await tap(harness, telegramId, messageId, `fc:rate:good:${words.pes.translationId}`);

    // Assert — scheduled like any Cards rating, and the next card is on the same message.
    const pes = (await vocabularyRepository.findById(words.pes.entryId))?.translations[0];
    expect(pes?.srsReviewCount).toBe(2);
    expect(pes?.srsDueDate?.getTime()).toBeGreaterThan(Date.now());
    expect(await reviewLog(words.pes.entryId)).toEqual(["flashcard"]);
    const next = lastScreen(harness.sent);
    expect((next?.payload as { message_id?: number }).message_id).toBe(messageId);
    expect(textOf(next)).toContain("Card 2 of 3");
    expect(textOf(next)).toContain("kočka");
    expect((await readSession(telegramId))?.cards?.currentIndex).toBe(1);
  });

  it("D3: a word removed after the notification was sent leaves the deck to what is due now", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 3);
    const words = await seedDueWords(userId);
    const delivered = await deliver(harness, telegramId);
    await vocabularyRepository.delete(words.pes.entryId, userId);

    // Act
    await tap(harness, telegramId, delivered.messageId!, `notif:deck:${words.pes.entryId}`);

    // Assert
    expect(textOf(lastScreen(harness.sent))).toContain("kočka");
    expect((await readSession(telegramId))?.cards?.deck.map((card) => card.original)).toEqual([
      "kočka",
      "dům",
      "strom",
    ]);
  });

  it("D4: one card per notification is still a card, rated with the same four ratings", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 1);
    const words = await seedDueWords(userId);

    // Act
    const delivered = await deliver(harness, telegramId);

    // Assert — the card's front and buttons, no count, no old grade row.
    expect(textOf(delivered)).not.toContain("Cards to review");
    expect(textOf(delivered)).toContain("pes");
    expect(buttonsOf(delivered)).toEqual([
      `notif:deck:${words.pes.entryId}`,
      `notif:learned:${words.pes.entryId}`,
      "notif:settings",
    ]);

    // Act — Reveal.
    await tap(harness, telegramId, delivered.messageId!, `notif:deck:${words.pes.entryId}`);

    // Assert — the four ratings of Cards, on a deck of one.
    const back = lastScreen(harness.sent);
    expect(buttonsOf(back)).toEqual(
      expect.arrayContaining(
        (["again", "hard", "good", "easy"] as const).map((rating) => `fc:rate:${rating}:${words.pes.translationId}`),
      ),
    );
    expect(buttonsOf(back).some((data) => data.startsWith("notif:fb:"))).toBe(false);
    expect((await readSession(telegramId))?.cards?.deck).toHaveLength(1);
  });

  it("D5: the settings button opens the notification settings as a new message and leaves the notification be", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 3);
    await seedDueWords(userId);
    const delivered = await deliver(harness, telegramId);

    // Act
    await tap(harness, telegramId, delivered.messageId!, "notif:settings");

    // Assert — a fresh message with the screen; nothing edited the notification.
    const screen = messagesTo(harness.sent, telegramId).find((call) => buttonsOf(call).includes("set:notif:toggle"));
    expect(textOf(screen)).toContain("Cards per notification — 3");
    expect(buttonsOf(screen)).toEqual(expect.arrayContaining(["set:notif:batch", "set:card"]));
    expect(harness.sent.some((call) => call.method.startsWith("editMessage"))).toBe(false);
  });

  it("D6: choosing a size stores it, and a size the screen never offered writes nothing", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeSubscriber(telegramId, 1);
    const messageId = 4242;

    // Act — open the picker.
    await tap(harness, telegramId, messageId, "set:notif:batch");

    // Assert — the offered sizes, the current one marked.
    const picker = lastScreen(harness.sent);
    expect(buttonsOf(picker)).toEqual([
      "set:notif:batch:1",
      "set:notif:batch:3",
      "set:notif:batch:5",
      "set:notif:batch:10",
      "set:notif",
    ]);

    // Act — pick 5.
    await tap(harness, telegramId, messageId, "set:notif:batch:5");

    // Assert
    expect((await userRepository.getSettings(userId))?.notificationBatchSize).toBe(5);
    expect(textOf(lastScreen(harness.sent))).toContain("Cards per notification — 5");

    // Act — a forged size.
    await tap(harness, telegramId, messageId, "set:notif:batch:7");

    // Assert
    expect((await userRepository.getSettings(userId))?.notificationBatchSize).toBe(5);
  });
});
