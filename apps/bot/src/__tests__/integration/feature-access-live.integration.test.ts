/**
 * Live plan → feature configuration — grammY e2e integration test.
 *
 * The admin panel writes `plan_feature_access` directly (PUT /rate-limits) and
 * the bot resolves entitlements from the DB on every gate check, so an edit
 * must change the paywall decision immediately: no restart, no cache. This
 * drives the full path (dispatcher → mode router → paid-feature gate →
 * featureAccess → real Postgres) on a synthetic plan, flipping the mentor key
 * on and off between updates.
 */
import { planFeatureAccessRepository, rateLimitPlanRepository, userRepository } from "@polyglot/adapter-db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const PLAN = "it-live-features";

async function arrangePlan(features: string[]): Promise<void> {
  await rateLimitPlanRepository.upsert({
    name: PLAN,
    label: "Live IT",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "none",
    mentorDailyLimit: null,
    // Not for sale: invisible to upgrade screens other workers may render.
    priceUsdCents: null,
    isActive: false,
    isDefault: false,
    aiModelId: null,
  });
  await planFeatureAccessRepository.setFeaturesForPlan(PLAN, features);
}

const sends = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

function upgradeButtons(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

afterAll(async () => {
  await rateLimitPlanRepository.delete(PLAN);
});

describe("live plan feature configuration (integration)", () => {
  it("an admin edit to plan_feature_access flips the mentor gate without a restart", async () => {
    await arrangePlan([]);
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { plan: PLAN });
    const generateChat = vi.fn().mockResolvedValue("Present Perfect links a past event to now.");
    const harness = createBotHarness({ ai: { ...deterministicTranslateAi(), generateChat } });

    // Plan without the key: /mentor is refused with the upgrade screen.
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    expect(upgradeButtons(sends(harness).at(-1)).some((data) => data.startsWith("plan:buy:"))).toBe(true);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    expect(generateChat).not.toHaveBeenCalled();

    // The admin grants mentor to the plan — the very next update sees it.
    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, ["mentor"]);
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");
    await harness.dispatch(
      messageUpdate({ chatId: telegramId, fromId: telegramId, text: "how does Present Perfect work?", messageId: 11 }),
    );
    expect(generateChat).toHaveBeenCalledTimes(1);

    // The admin revokes it again: the in-mode authoritative gate refuses the
    // next turn — proof the decision is read from the DB per update.
    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, []);
    await harness.dispatch(
      messageUpdate({ chatId: telegramId, fromId: telegramId, text: "and Past Simple?", messageId: 12 }),
    );
    expect(generateChat).toHaveBeenCalledTimes(1);
    expect(upgradeButtons(sends(harness).at(-1)).some((data) => data.startsWith("plan:buy:"))).toBe(true);
  });
});
