/**
 * Re-engagement of lapsed subscribers — e2e (real wiring, real Postgres, fake `fetch`).
 *
 * The defect this lane exists to catch is a *silence*, and silence is exactly
 * what no unit test can distinguish from success. Two designs failed here in
 * turn, both invisible from the mocked lane:
 *
 *  1. The sweep answered inactivity by switching `notification_enabled` off —
 *     but that flag is also a predicate of the sweep's own candidate query, so
 *     re-engagement fired once per account and then selected nobody, forever.
 *  2. It then sent four plain-text nudges and went quiet, which reached the
 *     people with an empty dictionary — the ones most in need of a reason to
 *     come back — with nothing but nagging.
 *
 * What ships instead: one real word card every few days, drawn from the curated
 * preset set when the user's own dictionary has nothing, continuing for as long
 * as they stay away. The evidence accepted here is a captured outbound Telegram
 * `sendMessage` attributed to **this test's own `chat_id`**, carrying the
 * headword — never a `{ processed: N }` counter, which the sweep computes over a
 * globally-scanned shared database. The persisted-state leg of the assertion
 * triad is the lapse counter and the `notification_history` row.
 *
 * Unlike the delivery lane this file needs no slot ownership: the sweep is
 * time-of-day independent, so there is no window to collide over. What it does
 * need is for its users to be invisible to the delivery lane, which the 20-day
 * `last_interaction_at` guarantees — a lapsed user is past the reachability
 * ceiling and `getUsersForWindow` will not return them at any hour.
 */
import { notificationRepository, userRepository } from "@polyglot/adapter-db";
import { processLapsedUsers } from "@polyglot/adapter-notifications";
import { t } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import {
  arrangeCuratedPresets,
  arrangeLapsedUser,
  arrangeNotifiableUser,
  LAPSED_DAYS,
  setLapseState,
} from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

/** Users the current test created. Drained unconditionally in `afterEach`. */
const seededUserIds: number[] = [];

async function arrangeTrackedLapsed(options: { pingsAlreadySent?: number; withVocabulary?: boolean } = {}) {
  const user = await arrangeLapsedUser(uniqueTelegramId(), options);
  seededUserIds.push(user.userId);
  return user;
}

/** Outbound `sendMessage` calls addressed to one chat — the only evidence this file accepts. */
function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

function textOf(call: CapturedCall): string {
  return String((call.payload as { text?: string }).text ?? "");
}

async function runSweep(harness: BotHarness): Promise<void> {
  const { sendFn, reEngagementSendFn, deps } = await buildNotificationScheduling(harness.bot.api);
  await processLapsedUsers(sendFn, reEngagementSendFn, deps);
}

afterEach(async () => {
  // Unconditional, deliberately: a teardown line at the end of each `it` only
  // runs on the success path, and a lapsed subscriber left enabled in the shared
  // database would be picked up by every later sweep in the run — including
  // another test's, whose chat-scoped assertions would then be measuring this
  // test's leftovers.
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

describe("lapsed-user re-engagement (integration)", () => {
  it("R1: sends a lapsed subscriber their own saved word and keeps the subscription on", async () => {
    const harness = createBotHarness();
    const { userId, telegramId, headword } = await arrangeTrackedLapsed({ withVocabulary: true });
    harness.reset();

    await runSweep(harness);

    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).toContain(headword);

    // The regression the whole feature exists for: going quiet must not switch
    // the subscription off, or the user drops out of the candidate query.
    const settings = await userRepository.getSettings(userId);
    expect(settings?.notificationEnabled).toBe(true);
    expect(settings?.reengagementCount).toBe(1);
  });

  it("R2: sends a curated preset word to a lapsed subscriber whose dictionary is empty", async () => {
    // This is the population the previous design served worst: no saved words
    // means nothing to send, so they got a bare "come back" nudge four times and
    // then nothing at all. The curated set exists precisely for them.
    const harness = createBotHarness();
    const curated = await arrangeCuratedPresets("cs", "en", 3);
    const { userId, telegramId } = await arrangeTrackedLapsed({ withVocabulary: false });
    harness.reset();

    await runSweep(harness);

    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(curated.some((headword) => textOf(mine[0]!).includes(headword))).toBe(true);

    // ...and it is recorded, which is what stops the next card repeating it.
    const sent = await notificationRepository.getSentWordsSince(userId, new Date(Date.now() - 60_000));
    expect(sent).toHaveLength(1);
    expect(curated).toContain(sent[0]);
  });

  it("R3: does not repeat the previous word on the next card", async () => {
    // The de-dup window the daily lane uses is 24 hours, which at this cadence
    // has always expired — and the preset picker takes the FIRST unseen
    // candidate, so a short window would mail one headword forever.
    const harness = createBotHarness();
    await arrangeCuratedPresets("cs", "en", 3);
    const { userId, telegramId } = await arrangeTrackedLapsed({ withVocabulary: false });
    harness.reset();

    await runSweep(harness);
    // Age the spacing clock so the next card is due, leaving the history intact.
    await setLapseState(userId, { lastReengagementAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    await runSweep(harness);

    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(2);
    expect(textOf(mine[1]!)).not.toBe(textOf(mine[0]!));
  });

  it("R4: does not send twice before the spacing interval has elapsed", async () => {
    const harness = createBotHarness();
    const { telegramId } = await arrangeTrackedLapsed();
    harness.reset();

    await runSweep(harness);
    await runSweep(harness);

    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
  });

  it("R5: keeps sending however long the user has been gone — there is no cap", async () => {
    const harness = createBotHarness();
    await arrangeCuratedPresets("cs", "en", 3);
    const { userId, telegramId } = await arrangeTrackedLapsed({ pingsAlreadySent: 40, withVocabulary: false });
    harness.reset();

    await runSweep(harness);

    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
    const settings = await userRepository.getSettings(userId);
    expect(settings?.reengagementCount).toBe(41);
    expect(settings?.notificationEnabled).toBe(true);
  });

  it("R6: resets the episode when the user comes back", async () => {
    const harness = createBotHarness();
    const { userId, telegramId } = await arrangeTrackedLapsed({ pingsAlreadySent: 12 });
    harness.reset();

    await userRepository.updateLastInteraction(userId);
    expect((await userRepository.getSettings(userId))?.reengagementCount).toBe(0);

    // Back and active: the sweep must leave them alone, because the per-slot
    // daily cards have taken over again.
    await runSweep(harness);
    expect(messagesTo(harness.sent, telegramId)).toEqual([]);

    // Drifting away again earns a fresh card rather than the spent budget the
    // old design would have left behind.
    await setLapseState(userId, { lastInteractionAt: new Date(Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000) });
    await runSweep(harness);
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
  });

  it("R7: leaves an active subscriber alone", async () => {
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeNotifiableUser(telegramId);
    seededUserIds.push(userId);
    await userRepository.updateLastInteraction(userId);
    harness.reset();

    await runSweep(harness);

    expect(messagesTo(harness.sent, telegramId)).toEqual([]);
  });

  it("R8: falls back to a plain invitation when no source can supply a word", async () => {
    // A learning language with no curated set and no saved words: every layer
    // returns null. Silence would be the one outcome this feature must never
    // produce, so the text nudge survives as the floor.
    const harness = createBotHarness();
    const telegramId = uniqueTelegramId();
    const { userId } = await arrangeNotifiableUser(telegramId, { withVocabulary: false });
    seededUserIds.push(userId);
    await userRepository.updateSettings(userId, {
      interfaceLang: "en",
      nativeLang: "en",
      // `sw` has no hook words and no demo cards, so the preset layer has no
      // candidate to resolve at all.
      learningLangs: ["sw"],
      lastSourceLang: null,
    });
    await setLapseState(userId, { lastInteractionAt: new Date(Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000) });
    harness.reset();

    await runSweep(harness);

    const mine = messagesTo(harness.sent, telegramId);
    expect(mine).toHaveLength(1);
    expect(textOf(mine[0]!)).toBe(t("notifReEngagement", "en"));
  });
});
