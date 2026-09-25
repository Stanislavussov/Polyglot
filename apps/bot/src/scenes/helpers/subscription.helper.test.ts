/**
 * Task 84 — the upgrade offer during an onboarding trial.
 *
 * Spec under test: a trial is a gift, not a purchase, so the tier it grants must
 * stay both *visible* and *buyable* while the trial runs. Priced at its face
 * value the trial plan would put the user above the rung they are trialling, and
 * the two places that read "what has this user already paid for" would then hide
 * Plus from the comparison and refuse a tap on it as a downgrade — refusing the
 * one conversion the reverse trial exists to produce.
 *
 * A *paying* subscriber on the same plan must still be refused: `activate`
 * supersedes the running period, so buying the plan you already hold pays to
 * restart it, and a Pro subscriber tapping a stale Plus button would pay to lose
 * Pro.
 */
import { type PlanLimitConfig, type Subscription, TRIAL_PLAN, TRIAL_PROVIDER } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { mockPaymentAdapter } from "../../payment.js";
import { createServicesStub, createSettingsStub } from "../../test-helpers/services-stub.js";
import type { BotContext } from "../../types.js";
import { handleBuyPlanCallback, handleConfirmPlanCallback, sendUpgradeScreen } from "./subscription.helper.js";

const PLANS: PlanLimitConfig[] = [
  {
    name: "free",
    label: "Free",
    translationLimit: 30,
    creditCost: 1,
    videoLimit: 0,
    videoWindow: "none",
    mentorDailyLimit: 0,
    priceUsdCents: null,
    isActive: true,
    isDefault: true,
  },
  {
    name: "plus",
    label: "Plus",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 20,
    videoWindow: "monthly",
    mentorDailyLimit: 30,
    priceUsdCents: 500,
    isActive: true,
    isDefault: false,
  },
  {
    name: "pro",
    label: "Pro",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "monthly",
    mentorDailyLimit: null,
    priceUsdCents: 1000,
    isActive: true,
    isDefault: false,
  },
];

function subscription(overrides: Partial<Subscription>): Subscription {
  return {
    id: 1,
    userId: 42,
    plan: TRIAL_PLAN,
    status: "active",
    provider: TRIAL_PROVIDER,
    externalId: null,
    currentPeriodEnd: new Date("2026-09-18T12:00:00Z"),
    createdAt: new Date("2026-09-11T12:00:00Z"),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createCtx(options: {
  plan: string;
  active: Subscription | null;
  buy?: string;
  confirm?: string;
  /** False = production, where the test checkout is closed and no payment port is wired. */
  purchasesOpen?: boolean;
}) {
  const settings = createSettingsStub();
  settings.getPlanLimits = vi.fn().mockResolvedValue(PLANS);
  settings.getPlanLimit = vi.fn(async (name: string) => PLANS.find((plan) => plan.name === name) ?? null);

  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const createSubscription = vi.fn();
  const callbackData = options.buy
    ? `plan:buy:${options.buy}`
    : options.confirm
      ? `plan:confirm:${options.confirm}`
      : undefined;

  const ctx = {
    user: { id: 42, audienceGroup: "product", subscriptionPlan: options.plan },
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    reply,
    services: createServicesStub({
      settings,
      featureAccess: {
        checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
        listFeatures: vi.fn().mockResolvedValue(new Set<string>()),
        listPlanFeatures: vi.fn().mockResolvedValue(new Set<string>()),
      },
      paymentPort: options.purchasesOpen === false ? undefined : mockPaymentAdapter,
      subscriptionRepository: {
        create: createSubscription,
        findActiveByUser: vi.fn(async () => options.active),
        findTrialByUser: vi.fn(async () => null),
        findTrialsEndingBetween: vi.fn(async () => []),
        findExpired: vi.fn(async () => []),
        extend: vi.fn(),
        updateStatus: vi.fn(),
      },
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", timezone: "UTC" }),
      } as unknown as BotContext["services"]["userRepository"],
    }),
  } as unknown as BotContext;

  return { ctx, reply, createSubscription };
}

function replyText(reply: ReturnType<typeof vi.fn>): string {
  return String(reply.mock.calls[0]?.[0] ?? "");
}

/** The `plan:buy:*` targets the offer actually put on screen, in ladder order. */
function offeredPlans(reply: ReturnType<typeof vi.fn>): string[] {
  const markup = reply.mock.calls[0]?.[1]?.reply_markup as
    | { inline_keyboard: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data ?? "")
    .filter((data) => data.startsWith("plan:buy:"))
    .map((data) => data.slice("plan:buy:".length));
}

describe("upgrade offer during an onboarding trial", () => {
  it("still offers the trialled tier for sale", async () => {
    const { ctx, reply } = createCtx({ plan: TRIAL_PLAN, active: subscription({}) });

    await sendUpgradeScreen(ctx);

    expect(offeredPlans(reply)).toEqual(["plus", "pro"]);
  });

  it("lets a trialling user buy the tier they are trialling", async () => {
    const { ctx, reply } = createCtx({ plan: TRIAL_PLAN, active: subscription({}), buy: "plus" });

    await handleBuyPlanCallback(ctx);

    // The confirmation prompt names the plan and its price; the refusal does not.
    expect(replyText(reply)).toContain("Plus");
    expect(replyText(reply)).toContain("$5");
  });

  it("hides the tier a paying subscriber already holds", async () => {
    const { ctx, reply } = createCtx({ plan: "plus", active: subscription({ provider: "mock" }) });

    await sendUpgradeScreen(ctx);

    expect(offeredPlans(reply)).toEqual(["pro"]);
  });

  it("refuses a paying subscriber's tap on the plan they already hold", async () => {
    const { ctx, reply } = createCtx({ plan: "plus", active: subscription({ provider: "mock" }), buy: "plus" });

    await handleBuyPlanCallback(ctx);

    expect(replyText(reply)).not.toContain("$5");
    expect(replyText(reply)).toContain("Plus");
  });

  it("treats a user with no subscription row at all as having paid nothing", async () => {
    const { ctx, reply } = createCtx({ plan: "free", active: null, buy: "plus" });

    await handleBuyPlanCallback(ctx);

    expect(replyText(reply)).toContain("$5");
  });
});

/**
 * Spec: in production the test checkout is closed (no payment port). The plans
 * and prices stay on screen, so demand is still visible, but buying says plainly
 * that payments are not open yet: no price confirmation, no subscription. A
 * confirm button left in the chat from before the switch grants nothing either.
 */
describe("upgrade offer while buying is closed", () => {
  it("still shows the plans, noting that payments are not open yet", async () => {
    const { ctx, reply } = createCtx({ plan: "free", active: null, purchasesOpen: false });

    await sendUpgradeScreen(ctx);

    expect(offeredPlans(reply)).toEqual(["plus", "pro"]);
    expect(replyText(reply)).toContain("payments are coming soon");
    expect(replyText(reply)).not.toContain("Test payment");
  });

  it("answers a tap on a plan with the coming-soon notice instead of a price confirmation", async () => {
    const { ctx, reply, createSubscription } = createCtx({
      plan: "free",
      active: null,
      buy: "plus",
      purchasesOpen: false,
    });

    await handleBuyPlanCallback(ctx);

    expect(replyText(reply)).toContain("payments are coming soon");
    expect(replyText(reply)).not.toContain("$5");
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("grants nothing through a confirm button left over from the test checkout", async () => {
    const { ctx, reply, createSubscription } = createCtx({
      plan: "free",
      active: null,
      confirm: "pro",
      purchasesOpen: false,
    });

    await handleConfirmPlanCallback(ctx);

    expect(replyText(reply)).toContain("payments are coming soon");
    expect(createSubscription).not.toHaveBeenCalled();
  });
});
