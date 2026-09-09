/**
 * The weekly proof line inside a scheduled notification — e2e (Task 81, §2.2 S4).
 *
 * This is the motivation layer's only outbound surface, and the three properties
 * it must hold are all invisible to the unit lane, because all three are about
 * rows in a real database read through the real delivery function:
 *
 *  1. **At most one line per 7 days**, and the "once" is *persisted* — a process
 *     restart between two ticks must not hand the user a second line. The token
 *     lives in `momentum_events`, so only a real journal can prove it.
 *  2. **`motivation.enabled = false` costs nothing** — not "roughly the same
 *     card", but the same bytes the formatter produced before this layer existed.
 *  3. **A non-subscriber's outbound traffic is unchanged.** The layer adds no
 *     `sendMessage` of its own (§10); the only evidence for that is a captured
 *     outbound call count attributed to this test's own chat.
 *
 * **Its own UTC slot (15:00).** `notification-delivery` and
 * `notification-feedback` both drive batches at 13:00, and `checkAndSend` scans
 * the whole table: a user of this file picked up by their tick would have their
 * week burned by a delivery this file never made, and the failure would surface
 * here as "the line did not appear" with nothing local to blame.
 *
 * **Where `sendFn` is called directly rather than through `checkAndSend`.** The
 * repeat-delivery legs move the injected clock forward by a day and by eight
 * days. `sendFn` is the production delivery function this module returns —
 * settings read, card render, momentum read, `api.sendMessage`, token write —
 * and it is where the whole weekly rule lives. Routing the repeats through the
 * batch would additionally require the word picker to produce a *different* word
 * on each tick (a one-word dictionary sends the empty-dictionary prompt instead),
 * which tests the picker, not the rule. The first leg goes through the real batch
 * so the wiring from `checkAndSend` to the footer is proven end to end.
 */
import {
  momentumRepository,
  notificationRepository,
  systemSettingsRepository,
  userRepository,
} from "@polyglot/adapter-db";
import { checkAndSend, type NotificationPayload, type SchedulerDeps } from "@polyglot/adapter-notifications";
import { type GenerateObjectFn, type MotivationConfig, t } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { formatNotificationMessage } from "../../notifications/notification.formatter.js";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser, type NotifiableUser } from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { languageOrderFromSettings } from "../../utils/language-order.js";

/** This file's own slot — see the header. Nothing else in the repo configures 15:00. */
const WEEKLY_SLOT_UTC = { hour: 15, minute: 0 } as const;
const WEEKLY_SLOT_TIME = "15:00";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The same tripwire the delivery lane uses: a live just-in-time AI call means a mis-seeded fixture. */
function createAiTripwire(): { fn: GenerateObjectFn; wasCalled: () => boolean } {
  let called = false;
  const fn: GenerateObjectFn = async <T>(): Promise<T> => {
    called = true;
    throw new Error("NO_LIVE_AI_IN_TESTS: a just-in-time AI translation was reached — the fixture is mis-seeded");
  };
  return { fn, wasCalled: () => called };
}

/** A card the delivery function can render without touching the picker — for the legs that move the clock. */
function payloadFor(headword: string): NotificationPayload {
  return {
    hour: WEEKLY_SLOT_UTC.hour,
    word: { original: headword, emoji: "🌉", translations: { cs: "most" }, source: "srs" },
  };
}

function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

function textOf(call: CapturedCall): string {
  return String((call.payload as { text?: string }).text ?? "");
}

/** Seed journal rows the weekly counts read. Weight matches the real recorder so a replay stays honest. */
async function seedMomentum(
  userId: number,
  kind: "mature" | "review",
  count: number,
  occurredAt: Date,
  keyTag: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await momentumRepository.recordEvent({
      userId,
      kind,
      weight: kind === "mature" ? 10 : 3,
      occurredAt,
      dedupeKey: `${kind}:${keyTag}:${i}`,
    });
  }
}

/**
 * Run `act` with the global `motivation` blob set, then put back exactly what was
 * there. Global rather than per-user, like the notification defaults in the
 * delivery lane: a mid-test failure must not leave the layer switched on for every
 * later file, worker and run.
 */
async function withMotivation<T>(config: MotivationConfig, act: () => Promise<T>): Promise<T> {
  const previous = await systemSettingsRepository.get<MotivationConfig>("motivation");
  try {
    await systemSettingsRepository.set("motivation", config);
    return await act();
  } finally {
    if (previous) {
      await systemSettingsRepository.set("motivation", previous);
    } else {
      await systemSettingsRepository.delete("motivation");
    }
  }
}

const MOTIVATION_ON: MotivationConfig = {
  recordingEnabled: true,
  enabled: true,
  praiseEnabled: false,
  recoveryEnabled: false,
};
const MOTIVATION_OFF: MotivationConfig = { ...MOTIVATION_ON, enabled: false };
/** The surface is on but the journal is closed — the combination W6 is about. */
const MOTIVATION_NOT_RECORDING: MotivationConfig = { ...MOTIVATION_ON, recordingEnabled: false };

/**
 * The real scheduling pipeline pinned to this file's slot, with both just-in-time
 * AI paths closed and the momentum clock under the test's control.
 *
 * Built INSIDE `withMotivation`, always: `buildNotificationScheduling` constructs a
 * fresh `SettingsService` whose 60-second cache starts empty, so the blob must
 * already be written when the build runs.
 */
async function buildDelivery(
  harness: BotHarness,
  now: () => Date,
): Promise<{
  sendFn: (userId: number, payload: NotificationPayload) => Promise<void>;
  deps: SchedulerDeps;
  ai: { wasCalled: () => boolean };
}> {
  const ai = createAiTripwire();
  const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, { generateObject: ai.fn, now });
  return { sendFn, ai, deps: { ...deps, now: () => WEEKLY_SLOT_UTC, pickPresetWord: async () => null } };
}

async function arrangeSubscriber(telegramId: number, notificationEnabled = true): Promise<NotifiableUser> {
  const user = await arrangeNotifiableUser(telegramId, {
    notificationTimes: [WEEKLY_SLOT_TIME],
    notificationEnabled,
  });
  seededUserIds.push(user.userId);
  return user;
}

const seededUserIds: number[] = [];

afterEach(async () => {
  // Unconditional: a test that fails midway must not leave an enabled subscriber
  // pinned to this file's slot in the shared database.
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("weekly proof line in a scheduled notification (integration)", () => {
  it("W1: shows the line once, suppresses it the next day, and shows it again after seven days", async () => {
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeSubscriber(telegramId);

    const settings = await userRepository.getSettings(userId);
    const payload = payloadFor(headword);
    /** The exact card this payload renders with no footer — the comparison a suppressed line must match. */
    const bare = formatNotificationMessage(payload, "en", languageOrderFromSettings(settings));

    const base = new Date();
    let clock = base;
    await seedMomentum(userId, "mature", 2, new Date(base.getTime() - 3600_000), "w1a");
    await seedMomentum(userId, "review", 5, new Date(base.getTime() - 3600_000), "w1a");

    await withMotivation(MOTIVATION_ON, async () => {
      const { sendFn, deps, ai } = await buildDelivery(harness, () => clock);

      // Act 1 — the real batch. Day 0: two words matured, five reviews done.
      harness.reset();
      await checkAndSend(sendFn, deps);

      const first = messagesTo(harness.sent, telegramId);
      expect(first).toHaveLength(1);
      expect(textOf(first[0]!)).toContain(headword);
      expect(textOf(first[0]!).endsWith(t("weeklyProofLine", "en", { mature: 2, reviews: 5 }))).toBe(true);
      expect(ai.wasCalled()).toBe(false);

      // Act 2 — the next day. The evidence is still inside the seven-day window,
      // so only the persisted token can be what holds the line back.
      clock = new Date(base.getTime() + DAY_MS);
      harness.reset();
      await sendFn(userId, payload);

      const second = messagesTo(harness.sent, telegramId);
      expect(second).toHaveLength(1);
      expect(textOf(second[0]!)).toBe(bare);

      // Act 3 — eight days on, with a fresh week of evidence behind it. The day-0
      // token has aged out of the window; the day-0 events have too, so the counts
      // are the new week's, not a running total.
      await seedMomentum(userId, "mature", 1, new Date(base.getTime() + 7 * DAY_MS), "w1b");
      await seedMomentum(userId, "review", 2, new Date(base.getTime() + 7 * DAY_MS), "w1b");
      clock = new Date(base.getTime() + 8 * DAY_MS);
      harness.reset();
      await sendFn(userId, payload);

      const third = messagesTo(harness.sent, telegramId);
      expect(third).toHaveLength(1);
      expect(textOf(third[0]!).endsWith(t("weeklyProofLine", "en", { mature: 1, reviews: 2 }))).toBe(true);
    });
  });

  it("W2: says nothing when the week produced no evidence", async () => {
    // Praise is paid for by a fact (§0.1). A subscriber who did nothing gets the
    // card exactly as before — and, just as importantly, no token is burned, so
    // their first real week still earns a line.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeSubscriber(telegramId);

    const settings = await userRepository.getSettings(userId);
    const payload = payloadFor(headword);

    await withMotivation(MOTIVATION_ON, async () => {
      const { sendFn } = await buildDelivery(harness, () => new Date());
      harness.reset();
      await sendFn(userId, payload);

      expect(textOf(messagesTo(harness.sent, telegramId)[0]!)).toBe(
        formatNotificationMessage(payload, "en", languageOrderFromSettings(settings)),
      );
    });

    expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(0);
  });

  it("W3: with the kill switch off the card is byte-identical to the formatter's own output", async () => {
    // Not "contains no motivation text" — the same bytes. The evidence is seeded,
    // so the only thing standing between this user and a line is `enabled`.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeSubscriber(telegramId);
    await seedMomentum(userId, "mature", 2, new Date(), "w3");
    await seedMomentum(userId, "review", 5, new Date(), "w3");

    const settings = await userRepository.getSettings(userId);
    const payload = payloadFor(headword);

    await withMotivation(MOTIVATION_OFF, async () => {
      const { sendFn } = await buildDelivery(harness, () => new Date());
      harness.reset();
      await sendFn(userId, payload);

      const mine = messagesTo(harness.sent, telegramId);
      expect(mine).toHaveLength(1);
      expect(textOf(mine[0]!)).toBe(formatNotificationMessage(payload, "en", languageOrderFromSettings(settings)));
    });

    // And the switch being off must not quietly consume the week either.
    expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(0);
  });

  it("W4: a user who is not subscribed receives nothing — the layer adds no outbound message", async () => {
    // The non-goal made executable (§10): the weekly line rides an existing
    // notification or it does not happen. With the layer on and a week's worth of
    // evidence seeded, a non-subscriber's outbound count is still zero.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeSubscriber(telegramId, false);
    await seedMomentum(userId, "mature", 3, new Date(), "w4");
    await seedMomentum(userId, "review", 9, new Date(), "w4");

    await withMotivation(MOTIVATION_ON, async () => {
      const { sendFn, deps, ai } = await buildDelivery(harness, () => new Date());
      harness.reset();
      await checkAndSend(sendFn, deps);

      expect(messagesTo(harness.sent, telegramId)).toHaveLength(0);
      expect(ai.wasCalled()).toBe(false);
    });

    expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(0);
  });

  it("W5: a failed delivery does not burn the week", async () => {
    // The token is claimed only by a send that happened. A 400 here would
    // otherwise silence the retry's card — and every card for the next seven days.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeSubscriber(telegramId);
    await seedMomentum(userId, "mature", 1, new Date(), "w5");
    await seedMomentum(userId, "review", 4, new Date(), "w5");

    await withMotivation(MOTIVATION_ON, async () => {
      const { sendFn } = await buildDelivery(harness, () => new Date());
      harness.reset();
      harness.failNextSend({ error_code: 400, description: "Bad Request: message text is empty" });

      await expect(sendFn(userId, payloadFor(headword))).rejects.toThrow();
      expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(0);

      // `failNextSend` auto-resets, so the retry is the real second attempt — and
      // it still carries the line.
      await sendFn(userId, payloadFor(headword));
      const delivered = messagesTo(harness.sent, telegramId);
      expect(
        textOf(delivered[delivered.length - 1]!).endsWith(t("weeklyProofLine", "en", { mature: 1, reviews: 4 })),
      ).toBe(true);
      expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(1);
    });
  });
  it("W6: with recording off the line stays away and writes no journal row", async () => {
    // `recordingEnabled = false` is the switch that stops the journal growing. The
    // weekly line's own "once per 7 days" is held by a `weekly_proof` row, so a line
    // shown while recording is off could neither be recorded nor stopped — it would
    // ride every notification. Both the row and the line must be absent.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId, headword } = await arrangeSubscriber(telegramId);
    await seedMomentum(userId, "mature", 2, new Date(), "w6");
    await seedMomentum(userId, "review", 5, new Date(), "w6");

    const settings = await userRepository.getSettings(userId);
    const payload = payloadFor(headword);

    await withMotivation(MOTIVATION_NOT_RECORDING, async () => {
      const { sendFn } = await buildDelivery(harness, () => new Date());
      harness.reset();
      await sendFn(userId, payload);

      const mine = messagesTo(harness.sent, telegramId);
      expect(mine).toHaveLength(1);
      expect(textOf(mine[0]!)).toBe(formatNotificationMessage(payload, "en", languageOrderFromSettings(settings)));
    });

    expect(await momentumRepository.countEventsSince(userId, "weekly_proof", new Date(0))).toBe(0);
  });
});
