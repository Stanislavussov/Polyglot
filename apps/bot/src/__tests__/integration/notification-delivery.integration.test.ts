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
  notificationRepository,
  systemSettingsRepository,
  translationRequestRepository,
  userRepository,
} from "@polyglot/adapter-db";
import { checkAndSend, type NotificationPayload, type SchedulerDeps } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn, NotificationDefaults } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import type { NotifiableUser, NotifiableUserOptions } from "../../test-helpers/integration/arrange.js";
import {
  arrangeNotifiableUser,
  DELIVERY_TEST_SLOT_UTC,
  disableNotificationsFor,
} from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { callbackQueryUpdate, createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const HOUR_MS = 60 * 60 * 1000;

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

/** The real scheduling pipeline, pinned to this lane's slot with both AI paths closed. */
async function buildDelivery(harness: BotHarness): Promise<{
  sendFn: (userId: number, payload: NotificationPayload) => Promise<void>;
  deps: SchedulerDeps;
  ai: AiTripwire;
}> {
  const ai = createAiTripwire();
  const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, { generateObject: ai.fn });
  return {
    sendFn,
    ai,
    deps: {
      ...deps,
      now: () => DELIVERY_TEST_SLOT_UTC,
      pickPresetWord: async () => null,
    },
  };
}

/** Outbound `sendMessage` calls addressed to one chat — the only delivery evidence this file accepts. */
function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

function textOf(call: CapturedCall): string {
  return String((call.payload as { text?: string }).text ?? "");
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
  await Promise.all(ids.map((id) => disableNotificationsFor(id)));
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
    expect(ai.wasCalled()).toBe(false);
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
      notificationTimes: ["13:00"],
      withVocabulary: false,
    });
    harness.reset();

    // Act
    await harness.dispatch(
      callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 502, data: "set:notif:time:780" }),
    );

    // Assert — re-read from the database, not from the reply.
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationTimes).toEqual(["13:00"]);
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
      notificationTimes: ["13:00"],
      withVocabulary: false,
    });

    // Act
    for (const data of ["set:notif:time:780", "set:notif:toggle", "set:notif:toggle"]) {
      await harness.dispatch(callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId: 503, data }));
    }

    // Assert
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationEnabled).toBe(true);
    expect(settings?.notificationTimes).toEqual(["13:00"]);
  });
});
