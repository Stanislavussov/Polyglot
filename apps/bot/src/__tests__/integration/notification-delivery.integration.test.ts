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
import { notificationRepository, translationRequestRepository } from "@polyglot/adapter-db";
import { checkAndSend, type NotificationPayload, type SchedulerDeps } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import {
  arrangeNotifiableUser,
  DELIVERY_TEST_SLOT_UTC,
  disableNotificationsFor,
} from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { createBotHarness } from "../../test-helpers/integration/bot-harness.js";
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

describe("scheduled notification delivery (integration)", () => {
  it("C1: notifies a subscriber who translated today", async () => {
    // Arrange — an opted-in user who has used the bot today. Before the QUIET_DAYS
    // gate was removed this user was screened out of every batch, permanently,
    // while /settings kept rendering "Notifications: on".
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeNotifiableUser(telegramId);
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

    // Cleanup
    await disableNotificationsFor(userId);
  });

  it("C2: delivers the scheduled word to a subscriber in their configured slot", async () => {
    // Arrange
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeNotifiableUser(telegramId);
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

    // Cleanup
    await disableNotificationsFor(userId);
  });
});
