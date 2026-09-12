/**
 * The onboarding reverse trial — grammY e2e integration test (Task 84).
 *
 * Drives the whole arc through the real dispatcher, the real DI container and a
 * real Postgres: finishing onboarding writes a genuine `subscriptions` row and
 * flips the plan pointer, a Plus-only card button works while that row is live,
 * the lifecycle sweep closes the period and drops the user to free, and the same
 * button then answers with the upgrade screen instead.
 *
 * What a mock-only test cannot pin down and this does: that entitlements really
 * are derived from the plan pointer the grant wrote (nothing caches the old one),
 * that the closing sweep's downgrade is visible to the very next tap, and that
 * the once-per-account guard is a property of the SQL — an expired row still
 * spends the gift.
 *
 * The warn and extend halves of the sweep are covered elsewhere, because pinning
 * them here would mean a sweep instant near `now + 7d`, where every other file's
 * fresh trial row also sits: the decision table in
 * `packages/core/src/modules/subscriptions/subscriptions.test.ts`, the sweep's
 * handling of it in `apps/bot/src/subscriptions/trial-lifecycle.test.ts`, and the
 * queries all three paths rest on in
 * `packages/adapters/db/src/__tests__/trial-lifecycle.repository.integration.test.ts`.
 *
 * Shared-database note: `findTrialsEndingBetween` is global and this lane runs
 * two workers over one database, so a sweep driven at "now" would touch trials
 * seeded by other files. The arrange step therefore parks this user's period end
 * on a distinctive far-future instant and drives the sweep from there, which is
 * a window no other test's row can fall into. The 7-day length itself is
 * asserted on the row the grant wrote, before it is moved.
 */
import {
  identityRepository,
  momentumRepository,
  notificationRepository,
  subscriptionRepository,
  userRepository,
} from "@polyglot/adapter-db";
import {
  grantOnboardingTrial,
  TRIAL_DAYS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  TRIAL_PLAN,
  TRIAL_PROVIDER,
  t,
} from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { runTrialLifecycleSweep } from "../../subscriptions/trial-lifecycle.wiring.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

/** A window no other test's trial row can end inside — see the shared-database note. */
const PARKED_END = new Date("2027-03-01T00:00:00Z");
const AFTER_PARKED_END = new Date("2027-03-01T01:00:00Z");

const DAY_MS = 24 * 60 * 60 * 1000;

function texts(harness: BotHarness): string[] {
  return harness.sent
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? ""));
}

const tap = (harness: BotHarness, chatId: number, messageId: number, data: string) =>
  harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));

/** The message id of the first onboarding screen — the one every in-place edit targets. */
function firstScreenId(harness: BotHarness): number {
  const first = harness.sent.find((call) => call.method === "sendMessage");
  if (first?.messageId === undefined) throw new Error("no onboarding screen was sent");
  return first.messageId;
}

/** Walk a brand-new user through onboarding to completion, ending on the typed demo. */
async function completeOnboarding(harness: BotHarness, chatId: number): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "/start" }));
  const screenId = firstScreenId(harness);
  await tap(harness, chatId, screenId, "onb:nat:en");
  await tap(harness, chatId, screenId, "onb:lang:cs");
  await tap(harness, chatId, screenId, "onb:lvl:cs:B1");
  await tap(harness, chatId, screenId, "onb:done");
  // The typed demo runs the real pipeline and completes onboarding on the card.
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "hello" }));

  const userId = await identityRepository.resolveUserId("telegram", String(chatId));
  if (userId === null) throw new Error("onboarding did not create a user");
  return userId;
}

/** Render a fresh card and return its message id. */
async function renderCard(harness: BotHarness, chatId: number): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "hello" }));
  return lastRenderedCard(harness.sent).messageId;
}

function sweepServices() {
  return { subscriptionRepository, userRepository, notificationRepository, momentumRepository };
}

describe("onboarding reverse trial (integration)", () => {
  it("grants a week of Plus on completion, then hands the user to a free tier on expiry", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();

    // Act — finish onboarding.
    const userId = await completeOnboarding(harness, id);

    // Assert — a real trial row, a moved plan pointer, and a seven-day period.
    const granted = await subscriptionRepository.findTrialByUser(userId);
    expect(granted).toMatchObject({ plan: TRIAL_PLAN, provider: TRIAL_PROVIDER, status: "active" });
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe(TRIAL_PLAN);
    const lengthDays = Math.round((granted!.currentPeriodEnd.getTime() - granted!.createdAt.getTime()) / DAY_MS);
    expect(lengthDays).toBe(TRIAL_DAYS);
    // The closing screen announced the gift — the whole rendered line, not just
    // a digit that any onboarding copy might contain.
    const announcement = t("onbTrialGranted", "en", {
      days: String(TRIAL_DAYS),
      words: String(TRIAL_EXTENSION_WORDS),
      extraDays: String(TRIAL_EXTENSION_DAYS),
    });
    expect(texts(harness).some((text) => text.includes(announcement))).toBe(true);

    // Act — tap a Plus-only button while the trial is live.
    harness.reset();
    const cardId = await renderCard(harness, id);
    harness.reset();
    await tap(harness, id, cardId, `tr:clarifypost:${cardId}`);

    // Assert — the gate let it through: the context prompt, not a price list.
    expect(texts(harness)).toContain(t("clarifyTranslationPrompt", "en"));
    expect(texts(harness).some((text) => text.includes("$5"))).toBe(false);

    // Act — park the period end in this test's own window and sweep it.
    await subscriptionRepository.extend(granted!.id, PARKED_END);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    await runTrialLifecycleSweep({ sendMessage }, sweepServices(), AFTER_PARKED_END);

    // Assert — downgraded in the database, and told once.
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("free");
    // Filtered by recipient: the sweep is global and this lane shares one
    // database with the other worker, so only this user's messages are ours.
    const mine = () => sendMessage.mock.calls.filter(([chatId]) => chatId === id);
    expect(mine()).toHaveLength(1);

    // Act — sweep again the same day.
    await runTrialLifecycleSweep({ sendMessage }, sweepServices(), AFTER_PARKED_END);

    // Assert — nothing is sent twice.
    expect(mine()).toHaveLength(1);

    // Act — the same button, now that the user is on free.
    harness.reset();
    const freeCardId = await renderCard(harness, id);
    harness.reset();
    await tap(harness, id, freeCardId, `tr:clarifypost:${freeCardId}`);

    // Assert — the upgrade screen with real prices, and no context prompt.
    expect(texts(harness).some((text) => text.includes("$5"))).toBe(true);
    expect(texts(harness)).not.toContain(t("clarifyTranslationPrompt", "en"));
  });

  it("spends the gift once per account, even after the trial is over", async () => {
    // Arrange — an onboarded user with no subscription history.
    const userId = await arrangeOnboardedTranslator(uniqueTelegramId());
    const deps = { subscriptions: subscriptionRepository, users: userRepository };

    // Act
    const first = await grantOnboardingTrial(deps, userId);

    // Assert
    expect(first).toMatchObject({ granted: true, plan: TRIAL_PLAN });

    // Act — a second attempt while the first is still running.
    const second = await grantOnboardingTrial(deps, userId);

    // Assert
    expect(second).toEqual({ granted: false, reason: "already_trialled" });

    // Act — and once the row is expired and the user is back on free, which is
    // the state a returning user is actually in.
    const row = await subscriptionRepository.findTrialByUser(userId);
    await subscriptionRepository.updateStatus(row!.id, "expired");
    await userRepository.updateSubscriptionPlan(userId, "free");
    const third = await grantOnboardingTrial(deps, userId);

    // Assert — the guard is the existence of the row, not its status.
    expect(third).toEqual({ granted: false, reason: "already_trialled" });
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("free");
  });
});
