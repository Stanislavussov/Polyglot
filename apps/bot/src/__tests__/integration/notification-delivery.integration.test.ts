/**
 * Scheduled-notification delivery — e2e (real dispatcher path, real Postgres, fake `fetch`).
 *
 * The unit lane is structurally blind to the failures this file exists to catch:
 * both "the gate silently excludes every subscriber" and "the admin default is
 * never read" look like *nothing changed* from a mocked query builder. The only
 * evidence that counts here is a captured outbound Telegram `sendMessage`,
 * attributed to **this test's own `chat_id`** — never a `{ sent: N }` counter,
 * which `checkAndSend` computes over a globally-scanned, shared database.
 *
 * Three properties make the lane deterministic:
 *
 *  1. **An injected UTC clock** (`SchedulerDeps.now`). `vi.setSystemTime` cannot
 *     do this job: `vi.useFakeTimers({ toFake: ["Date"] })` patches `Date` only,
 *     while the batch and `getLocalMinutes` both read `Temporal.Now`, which stays
 *     on the wall clock. Without the seam a delivery test passes or fails
 *     according to the hour it happens to run at.
 *  2. **A dedicated slot** (`DELIVERY_TEST_SLOT_UTC`, 13:00 UTC) that no other
 *     file configures — the persistence lane pins itself to 08:00 and never
 *     cleans up, and `checkAndSend` scans the whole table.
 *  3. **No live AI, enforced rather than hoped for.** There are two just-in-time
 *     paths: the preset one (closed by `pickPresetWord: async () => null`) and
 *     the dictionary one (`translateEntry`, reachable on this file's OWN happy
 *     path when an entry has no translations, and which also WRITES to the DB).
 *     Both route through the single `generateObject` override, and every test
 *     asserts the tripwire never fired — a throwing stub alone is not enough,
 *     because `pickDictionaryWord` catches `translateEntry` failures and carries
 *     on.
 *
 * **Assertion triad, adapted.** The `bot-testing` skill's third leg is
 * session/FSM state; a cron tick has no session, so the persisted-state leg is
 * the `notification_history` row instead, scoped to this test's own `userId`.
 * This deviation is deliberate.
 */
import {
  notificationDeliveryRepository,
  notificationRepository,
  notificationTemplateRepository,
  systemSettingsRepository,
  translationRequestRepository,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import { checkAndSend, type NotificationPayload, type SchedulerDeps } from "@polyglot/adapter-notifications";
import { type GenerateObjectFn, type NotificationDefaults, t } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { notificationCounter } from "../../metrics.js";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import type { NotifiableUser, NotifiableUserOptions } from "../../test-helpers/integration/arrange.js";
import {
  arrangeCuratedPresets,
  arrangeNotifiableUser,
  DELIVERY_TEST_SLOT_TIME,
  DELIVERY_TEST_SLOT_UTC,
} from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { callbackQueryUpdate, createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const HOUR_MS = 60 * 60 * 1000;

/** The lane's own slot as the `set:notif:time:{minutes}` payload the picker sends. */
const DELIVERY_SLOT_CALLBACK = `set:notif:time:${DELIVERY_TEST_SLOT_UTC.hour * 60 + DELIVERY_TEST_SLOT_UTC.minute}`;

interface AiTripwire {
  fn: GenerateObjectFn;
  wasCalled: () => boolean;
}

/**
 * A `generateObject` that records the fact it was reached and then fails.
 *
 * The recording is the load-bearing half: `pickDictionaryWord` wraps its
 * `translateEntry` call in try/catch, so a stub that only throws is swallowed and
 * the test still goes green while a real run would have billed a model call and
 * written a translation row.
 */
function createAiTripwire(): AiTripwire {
  let called = false;
  const fn: GenerateObjectFn = async <T>(): Promise<T> => {
    called = true;
    throw new Error("NO_LIVE_AI_IN_TESTS: a just-in-time AI translation was reached — the fixture is mis-seeded");
  };
  return { fn, wasCalled: () => called };
}

/**
 * The real scheduling pipeline, pinned to this lane's slot with both AI paths
 * closed.
 *
 * The preset layer is nulled by default so every other test here asserts about
 * the dictionary lane alone; `withPresets` hands back the real picker for the
 * one test that is about presets.
 */
async function buildDelivery(
  harness: BotHarness,
  { withPresets = false }: { withPresets?: boolean } = {},
): Promise<{
  sendFn: (userId: number, payload: NotificationPayload) => Promise<void>;
  deps: SchedulerDeps;
  ai: AiTripwire;
}> {
  const ai = createAiTripwire();
  // The question is pinned so a layout assertion can name it; rotation is a formatter test.
  const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
    generateObject: ai.fn,
    pickSelfCheckVariant: () => 0,
  });
  return {
    sendFn,
    ai,
    deps: {
      ...deps,
      now: () => DELIVERY_TEST_SLOT_UTC,
      ...(withPresets ? {} : { pickPresetWord: async () => null }),
    },
  };
}

/** Outbound `sendMessage` calls addressed to one chat — the only delivery evidence this file accepts. */
function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

/**
 * One delivery outcome's count. Always read as a delta (see `deliveryDelta`):
 * the counter is process-global, so an absolute assertion would depend on test
 * execution order.
 */
async function deliveryCount(status: string): Promise<number> {
  const snapshot = (await notificationCounter.get()) as {
    values: Array<{ value: number; labels: { status?: string } }>;
  };
  return snapshot.values.find((v) => v.labels.status === status)?.value ?? 0;
}

/** Delivery-outcome counts before and after `act`, as a per-status delta. */
async function deliveryDelta(act: () => Promise<unknown>): Promise<Record<string, number>> {
  const statuses = ["delivery_sent", "delivery_failed", "delivery_blocked", "delivery_skipped"];
  const before = await Promise.all(statuses.map(deliveryCount));
  await act();
  const after = await Promise.all(statuses.map(deliveryCount));
  return Object.fromEntries(statuses.map((s, i) => [s, (after[i] ?? 0) - (before[i] ?? 0)]));
}

function textOf(call: CapturedCall): string {
  return String((call.payload as { text?: string }).text ?? "");
}

/** The admin panel's view of what this user was sent, newest first. */
async function journalFor(userId: number) {
  const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 10, userId });
  return deliveries;
}

/** Users the current test created. Drained unconditionally in `afterEach`. */
const seededUserIds: number[] = [];

async function arrangeTracked(telegramId: number, options?: NotifiableUserOptions): Promise<NotifiableUser> {
  const user = await arrangeNotifiableUser(telegramId, options);
  seededUserIds.push(user.userId);
  return user;
}

afterEach(async () => {
  // Unconditional, deliberately — a teardown line at the end of each `it` only
  // runs on the success path. A test that fails midway would otherwise leave an
  // enabled subscriber pinned to this lane's slot in the shared database for the
  // full 14-day reachability ceiling, and the next run's failure would point at
  // the wrong test. That matters most for the AI tripwire, which is the one
  // assertion here that is global over the batch rather than chat-scoped.
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("scheduled notification delivery (integration)", () => {
  it("C1: notifies a subscriber who translated today", async () => {
    // Arrange — an opted-in user who has used the bot today. Before the QUIET_DAYS
    // gate was removed this user was screened out of every batch, permanently,
    // while /settings kept rendering "Notifications: on".
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeTracked(telegramId);
    await translationRequestRepository.logTranslationRequest(userId, "hello", "en", ["cs"]);
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — the wire, then the persisted state.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).toContain(headword);
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([headword]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C2: delivers the scheduled word to a subscriber in their configured slot", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeTracked(telegramId);
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).toContain(headword);
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([headword]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C3: sends nothing to a user who has not opted in", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, { notificationEnabled: false });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — "nothing was sent" is the absence of a message to THIS chat, never
    // a global counter of zero.
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(0);
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C4: sends nothing outside the user's configured slot", async () => {
    // Arrange — a schedule three hours away from the window the batch runs in.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const offSlot = `${String(DELIVERY_TEST_SLOT_UTC.hour + 3).padStart(2, "0")}:00`;
    const { userId } = await arrangeTracked(telegramId, { notificationTimes: [offSlot] });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(0);
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C5: sends the empty-dictionary prompt when there is no word to send", async () => {
    // Arrange — subscribed, in-slot, but nothing to say. The preset layer is
    // already nulled on the shared deps, so this exercises the last fall-through.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, { withVocabulary: false });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — a prompt is not a delivery: it must not be recorded as one, or the
    // de-dup window would start excluding words that were never sent.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).toContain("Your dictionary is empty");
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([]);
    expect((await journalFor(userId)).map((row) => [row.kind, row.text])).toEqual([
      ["dictionary_empty", textOf(mine[0]!)],
    ]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C19: an empty dictionary gets a curated word, and never the same one twice", async () => {
    // The bug this closes was invisible to every mocked test: the daily lane read
    // its de-dup memory from a 24-hour window, which at one notification a day
    // holds a single send, so the preset queue came straight back around and the
    // logs showed the same few headwords forever. The fix is a second query with
    // its own horizon, filtered to preset sends — real SQL, so only a real
    // database can say whether it selects and orders what the picker needs.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    await arrangeCuratedPresets("cs", "en");
    const { userId } = await arrangeTracked(telegramId, { withVocabulary: false });
    const { sendFn, deps, ai } = await buildDelivery(harness, { withPresets: true });
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();

    // Act — two consecutive ticks, with the first tick's history left standing.
    await checkAndSend(sendFn, deps);
    await checkAndSend(sendFn, deps);

    // Assert — two cards, two different curated words, both filed as presets.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(2);
    expect(textOf(mine[0]!)).not.toEqual(textOf(mine[1]!));
    const sent = await notificationRepository.getSentWordsSince(userId, since);
    expect(new Set(sent).size).toBe(2);
    expect(await notificationRepository.getSentWordsFromSourceSince(userId, "preset", since)).toHaveLength(2);
    // The free path covers every seeded pair, so the JIT translation is never billed.
    expect(ai.wasCalled()).toBe(false);
  });

  it("C6: disables notifications after a 403 and does not retry", async () => {
    // Arrange — the user blocked the bot. This is permanent, not transient: the
    // retry ladder must not fire, and the subscription must be switched off so the
    // next tick does not try again forever.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId);
    const { sendFn, deps, ai } = await buildDelivery(harness);
    const since = new Date(Date.now() - HOUR_MS);
    harness.reset();
    harness.failNextSend({ error_code: 403, description: "Forbidden: bot was blocked by the user" });

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — exactly ONE attempt. `failNextSend` auto-resets, so a retry would
    // have succeeded and shown up as a second captured call.
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
    expect(await notificationRepository.getSentWordsSince(userId, since)).toEqual([]);
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationEnabled).toBe(false);
    // A message Telegram refused never reached the chat, so the admin must not see it as delivered.
    expect(await journalFor(userId)).toEqual([]);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C15: journals the delivered card with the exact text that reached the chat", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeTracked(telegramId);
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — the wire, then the journal row the admin panel reads.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    const journal = await journalFor(userId);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      kind: "word_card",
      text: textOf(mine[0]!),
      parseMode: "HTML",
      user: { id: userId, telegramId },
    });
    expect(journal[0]?.meta?.word).toBe(headword);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C17: tapping Reveal on a delivered card marks that delivery as opened", async () => {
    // Arrange — deliver, then tap the very message the harness sent, by its id.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, { richCard: true });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();
    await checkAndSend(sendFn, deps);

    const delivered = messagesTo(harness.sent, telegramId)[0];
    const markup = delivered?.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> };
    const reveal = markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith("notif:reveal:"));
    expect(delivered?.messageId).toBeDefined();
    expect((await journalFor(userId))[0]).toMatchObject({ openedAt: null, interactionCount: 0 });

    // Act — through the real dispatcher.
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: delivered!.messageId!,
        data: reveal!.callback_data!,
      }),
    );

    // Assert — the journal row the admin panel reads now carries the tap.
    const journal = await journalFor(userId);
    expect(journal).toHaveLength(1);
    expect(journal[0]?.interactionCount).toBe(1);
    expect(journal[0]?.openedAt).toBeInstanceOf(Date);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C18: a tap on a message that is not a notification opens nothing", async () => {
    // Arrange — a delivered card, and a tap addressed to some other message.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, { richCard: true });
    const { sendFn, deps } = await buildDelivery(harness);
    harness.reset();
    await checkAndSend(sendFn, deps);
    const delivered = messagesTo(harness.sent, telegramId)[0];

    // Act
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: delivered!.messageId! + 1000,
        data: "notif:tr",
      }),
    );

    // Assert
    expect((await journalFor(userId))[0]).toMatchObject({ openedAt: null, interactionCount: 0 });
  });

  it("C11: a delivered notification is counted as delivery_sent, and nothing else", async () => {
    // The alert divides delivery_failed by (sent + failed). If a healthy send
    // did not move the denominator, one failure would read as 100% and page.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    await arrangeTracked(telegramId);
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();

    const delta = await deliveryDelta(() => checkAndSend(sendFn, deps));

    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
    expect(delta.delivery_sent).toBe(1);
    expect(delta.delivery_failed).toBe(0);
    expect(delta.delivery_blocked).toBe(0);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C12: a blocked user is counted as delivery_blocked and never as delivery_failed", async () => {
    // Blocking is normal churn that accrues on a healthy system. If it fed
    // delivery_failed the ratio would drift upward on its own until the alert
    // fired for nothing.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    await arrangeTracked(telegramId);
    const { sendFn, deps } = await buildDelivery(harness);
    harness.reset();
    harness.failNextSend({ error_code: 403, description: "Forbidden: bot was blocked by the user" });

    const delta = await deliveryDelta(() => checkAndSend(sendFn, deps));

    expect(delta.delivery_blocked).toBe(1);
    expect(delta.delivery_failed).toBe(0);
    expect(delta.delivery_sent).toBe(0);
  });

  it("C13: a surfaced transient failure is counted as delivery_failed and still reaches the scheduler's retry", async () => {
    // Two things at once, because they are the same bug if either breaks: the
    // transient outcome must be counted, AND the wrapper must re-throw so the
    // scheduler's retry ladder still runs. `failNextSend` auto-resets, so the
    // retry succeeds — one failure and one success is the proof that the error
    // was counted without being swallowed.
    //
    // A 400, not a 5xx: `autoRetry()` sits below this wrapper and absorbs 429
    // and 5xx, resolving as if they had succeeded — an earlier draft asserting
    // on a 500 measured nothing. So delivery_failed counts only what grammY
    // already gave up on, which is the right denominator for an alert.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    await arrangeTracked(telegramId);
    const { sendFn, deps } = await buildDelivery(harness);
    harness.reset();
    harness.failNextSend({ error_code: 400, description: "Bad Request: message text is empty" });

    const delta = await deliveryDelta(() => checkAndSend(sendFn, deps));

    expect(delta.delivery_failed).toBe(1);
    expect(delta.delivery_blocked).toBe(0);
    expect(delta.delivery_sent).toBe(1);
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(2);
  });

  it("C10: delivers the word alone, handing over nothing that answers it", async () => {
    // Arrange — a ru-native user studying cs and de whose entry carries a native
    // translation, a stored meaning and a second learning language: everything the
    // card used to inline. The notification is a recall prompt, so none of it may
    // reach the chat before the reader taps Reveal. Only the real `sendFn` renders
    // from the real settings row, so a wiring regression that re-inlined the answer
    // would leave every unit test green.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { headword, nativeTranslation, nativeMeaning, otherTranslation } = await arrangeTracked(telegramId, {
      richCard: true,
    });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — the delivered text: the word, the prompt, and nothing else.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    const lines = textOf(mine[0]!)
      .split("\n")
      .filter((line) => line.trim() !== "");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(headword);
    expect(lines[1]).toContain(t("notifSelfCheck", "en"));
    expect(textOf(mine[0]!)).not.toContain(nativeTranslation!);
    expect(textOf(mine[0]!)).not.toContain(nativeMeaning!);
    expect(textOf(mine[0]!)).not.toContain(otherTranslation!);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C19: synonyms switched on in the notification template arrive below the question, never beside the word", async () => {
    // Arrange — the toggle goes through the real settings callback, so the row the
    // delivery reads is the one a user's tap writes.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeTracked(telegramId, { sourceSynonyms: ["span", "viaduct"] });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 1, data: "set:ntpl:t:synonyms" }),
    );
    expect(await notificationTemplateRepository.getFields(userId)).toEqual({ synonyms: true });
    const synonymsLine = t("notifSynonymsLine", "en", { synonyms: "span, viaduct" });
    // The settings screen previews the choice on the user's own latest word.
    expect(
      harness.sent.some((call) => String((call.payload as { text?: string }).text ?? "").includes(synonymsLine)),
    ).toBe(true);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert — the first two lines are what a phone's push preview shows: word and question.
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    const lines = textOf(mine[0]!)
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(headword);
    expect(lines[0]).not.toContain("span");
    expect(lines[1]).toContain(t("notifSelfCheck", "en"));
    expect(lines[2]).toBe(synonymsLine);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C20: an entry with synonyms still arrives as the bare prompt while the template leaves them off", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    await arrangeTracked(telegramId, { sourceSynonyms: ["span", "viaduct"] });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();

    // Act
    await checkAndSend(sendFn, deps);

    // Assert
    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).not.toContain("span");
    expect(
      textOf(mine[0]!)
        .split("\n")
        .filter((line) => line.trim() !== ""),
    ).toHaveLength(2);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C14: tapping Reveal opens the translation card, with the buttons a translation card has", async () => {
    // Arrange — deliver first, then tap the button the delivery actually carried:
    // the entry id travels from the picker into the callback data, and a card
    // revealed by a hand-built id would not prove that leg.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword, nativeTranslation, otherTranslation } = await arrangeTracked(telegramId, {
      richCard: true,
    });
    const { sendFn, deps, ai } = await buildDelivery(harness);
    harness.reset();
    await checkAndSend(sendFn, deps);

    const delivered = messagesTo(harness.sent, telegramId)[0];
    const markup = delivered?.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> };
    const reveal = markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith("notif:reveal:"));
    const entries = await vocabularyRepository.findByUser(userId);
    expect(reveal?.callback_data).toBe(`notif:reveal:${entries[0]?.id}`);

    // Act — through the real dispatcher, as the tap arrives.
    const nudgeMsgId = 800;
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: nudgeMsgId,
        data: reveal!.callback_data!,
      }),
    );

    // Assert — the card: the reader's own language, the second learning language,
    // and the answer directly under the headword, as every other card renders it.
    const revealed = harness.sent
      .filter((call) => call.method === "editMessageText")
      .map((call) => String((call.payload as { text?: string }).text ?? ""))
      .at(-1);
    expect(revealed).toBeDefined();
    const lines = revealed!.split("\n").filter((line) => line.trim() !== "");

    expect(lines[0]).toContain(headword);
    expect(lines[1]).toContain(nativeTranslation!);
    expect(revealed).toContain(otherTranslation!);

    // Assert — the keyboard is the translation card's, addressed to this message,
    // and it says the word is already saved rather than offering to save it twice.
    const buttons = harness.sent
      .filter((call) => call.method === "editMessageReplyMarkup")
      .map((call) => call.payload as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } })
      .at(-1)
      ?.reply_markup?.inline_keyboard?.flat()
      .map((button) => button.callback_data);

    // A fresh card ships collapsed, so what proves this is the card's keyboard is
    // the pair a collapsed card always carries — ⋯ More and Save — both addressed
    // to this message. Expanding it is `tr:more`'s job and is covered where that
    // behaviour lives.
    expect(buttons).toContain(`tr:more:${nudgeMsgId}`);
    expect(buttons).toContain(`tr:save:${nudgeMsgId}`);
    // The card owns the message now: apart from the recall grades, which address
    // the entry, every button is the card's own. Reveal and Remove do not survive.
    const entryId = entries[0]?.id;
    const grades = [`notif:fb:hard:${entryId}`, `notif:fb:normal:${entryId}`, `notif:fb:easy:${entryId}`];
    expect(buttons?.slice(0, 3)).toEqual(grades);
    expect(buttons?.slice(3).every((data) => data?.endsWith(`:${nudgeMsgId}`))).toBe(true);
    expect(ai.wasCalled()).toBe(false);
  });

  it("C15: the revealed card's buttons still work — the session entry travels with it", async () => {
    // The card addresses its own state by message id. Without that entry every
    // button on the freshly revealed card answers "this card has expired", which
    // is invisible to any assertion about the card's text.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { headword } = await arrangeTracked(telegramId, { richCard: true });
    const { sendFn, deps } = await buildDelivery(harness);
    await checkAndSend(sendFn, deps);

    const delivered = messagesTo(harness.sent, telegramId)[0];
    const markup = delivered?.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> };
    const reveal = markup.inline_keyboard.flat().find((b) => b.callback_data?.startsWith("notif:reveal:"));
    const nudgeMsgId = 810;
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: nudgeMsgId,
        data: reveal!.callback_data!,
      }),
    );

    // Act — tap Pronounce's neighbour: "save" is the one button that needs no AI
    // and reports what it found through the toast.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: nudgeMsgId,
        data: `tr:save:${nudgeMsgId}`,
      }),
    );

    // Assert — the word was recognised as this card's, not answered as expired.
    const answers = harness.sent
      .filter((call) => call.method === "answerCallbackQuery")
      .map((call) => String((call.payload as { text?: string }).text ?? ""));
    expect(answers.join(" ")).not.toMatch(/expired|устарел/i);
    expect(headword.length).toBeGreaterThan(0);
  });

  it("C16: a word can be graded after the reveal, and the grade survives the card's own taps", async () => {
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, { richCard: true });
    const { sendFn, deps } = await buildDelivery(harness);
    await checkAndSend(sendFn, deps);
    const [entry] = await vocabularyRepository.findByUser(userId);
    const entryId = entry!.id;
    const cardMsgId = 820;
    const tapCard = async (data: string): Promise<void> => {
      harness.reset();
      await harness.dispatch(
        callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: cardMsgId, data }),
      );
    };
    const lastButtons = (): Array<string | undefined> =>
      harness.sent
        .filter((call) => call.method === "editMessageReplyMarkup")
        .map(
          (call) =>
            call.payload as {
              reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> };
            },
        )
        .at(-1)
        ?.reply_markup?.inline_keyboard?.flat()
        .map((button) => (button.text.startsWith("✓") ? `✓${button.callback_data}` : button.callback_data)) ?? [];

    await tapCard(`notif:reveal:${entryId}`);
    await tapCard(`notif:fb:hard:${entryId}`);

    // DB: the grade landed. Wire: the card kept its buttons, with the grade marked.
    expect((await vocabularyRepository.findById(entryId))?.difficulty).toBe("hard");
    expect(lastButtons()).toContain(`✓notif:fb:hard:${entryId}`);
    expect(lastButtons()).toContain(`tr:more:${cardMsgId}`);

    // Opening the action list rebuilds the keyboard; the grades and the mark stay.
    await tapCard(`tr:more:${cardMsgId}`);
    expect(lastButtons()).toContain(`✓notif:fb:hard:${entryId}`);
    expect(lastButtons()).toContain(`tr:less:${cardMsgId}`);
  });
});

describe("notification schedule seeding and the deselect guard (integration)", () => {
  it("C7: seeds the admin-configured default the first time a user turns notifications on", async () => {
    // Arrange — this is the one row in the file that is GLOBAL to the database
    // rather than scoped to a unique telegram id, so it is captured first and
    // restored in `finally`: a mid-test failure must not leave every later file,
    // worker and run reading 21:30, and against a supplied TEST_DATABASE_URL an
    // unconditional delete would destroy operator state.
    //
    // Write it BEFORE building the harness: createContainer() constructs a fresh
    // SettingsService whose 60s cache starts empty, so the write is guaranteed
    // visible. If this test ever sees 19:00, that cache is the first suspect.
    const previous = await systemSettingsRepository.get<NotificationDefaults>("notifications");
    try {
      await systemSettingsRepository.set("notifications", {
        defaultTime: "21:30",
        defaultType: "srs",
        inactivityDays: 14,
        notificationTimesLimit: 12,
      });
      const harness = createBotHarness();
      const telegramId = uniqueTelegramId();
      const { userId } = await arrangeTracked(telegramId, {
        notificationEnabled: false,
        notificationTimes: [],
        withVocabulary: false,
      });
      harness.reset();

      // Act
      await harness.dispatch(
        callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 500, data: "set:notif:toggle" }),
      );

      // Assert — the admin knob, not a constant, decided the hour. 21:30 matches
      // no constant in the codebase, so this cannot pass by reading one.
      const settings = await userRepository.getSettings(userId);
      expect(settings?.notificationEnabled).toBe(true);
      expect(settings?.notificationTimes).toEqual(["21:30"]);
    } finally {
      if (previous) {
        await systemSettingsRepository.set("notifications", previous);
      } else {
        await systemSettingsRepository.delete("notifications");
      }
    }
  });

  it("C8: never overwrites a schedule the user already chose", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, {
      notificationTimes: ["06:00"],
      withVocabulary: false,
    });

    // Act — off, then on again. The round trip is the point: it is the only way a
    // user with a schedule can reach the seeding branch.
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 501, data: "set:notif:toggle" }),
    );
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 501, data: "set:notif:toggle" }),
    );

    // Assert
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationEnabled).toBe(true);
    expect(settings?.notificationTimes).toEqual(["06:00"]);
  });

  it("C9: refuses to deselect the last remaining slot", async () => {
    // Arrange — exactly one configured slot, notifications on.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, {
      notificationTimes: [DELIVERY_TEST_SLOT_TIME],
      withVocabulary: false,
    });
    harness.reset();

    // Act
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 502, data: DELIVERY_SLOT_CALLBACK }),
    );

    // Assert — re-read from the database, not from the reply.
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationTimes).toEqual([DELIVERY_TEST_SLOT_TIME]);
    // The guard refuses; it never disables. Auto-disabling would park the user at
    // enabled=false with an empty schedule — exactly the state the next toggle-on
    // seeds the admin default into.
    expect(settings?.notificationEnabled).toBe(true);

    // Exactly one answer, and it must be the refusal. Telegram accepts one answer
    // per query and drops the rest, so an implementation that answered "Removed
    // 13:00" first and then alerted would leave the user told their slot was
    // removed while it was in fact kept — and a laxer assertion would pass.
    const answers = harness.sent.filter((call) => call.method === "answerCallbackQuery");
    expect(answers).toHaveLength(1);
    const answer = answers[0]!.payload as { text?: string; show_alert?: boolean };
    expect(answer.show_alert).toBe(true);
    expect(String(answer.text)).not.toContain("Removed");
  });

  it("C9b: the guard cannot be walked around via toggle off and on", async () => {
    // Pre-mortem Scenario 2, executed end to end. Deselect the last slot (refused),
    // then off, then on. This passes only because the schedule was never allowed to
    // empty — without the guard the user would come back scheduled at a time they
    // never picked.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeTracked(telegramId, {
      notificationTimes: [DELIVERY_TEST_SLOT_TIME],
      withVocabulary: false,
    });

    // Act
    for (const data of [DELIVERY_SLOT_CALLBACK, "set:notif:toggle", "set:notif:toggle"]) {
      await harness.dispatch(callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 503, data }));
    }

    // Assert
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationEnabled).toBe(true);
    expect(settings?.notificationTimes).toEqual([DELIVERY_TEST_SLOT_TIME]);
  });
});
