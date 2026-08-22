/**
 * What the upgrade screen offers, and to whom.
 *
 * The screen is the only upsell surface in the bot, so the two ways it used to go
 * wrong were both dead ends for the user: it listed the plan the subscriber
 * already pays for (a button `refuseAsDowngrade` can only reject), and it
 * answered an empty catalogue with a ⚠️ failure notice for a state the user did
 * not cause. Both are pinned here, alongside the headline that ties the offer
 * back to the button that refused.
 */
import { FEATURE_KEYS, type PlanLimitConfig, type ServiceContainer } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { createServicesStub, createSettingsStub } from "../../../test-helpers/services-stub.js";
import type { BotContext } from "../../../types.js";
import { sendUpgradeScreen } from "../subscription.helper.js";

const PLAN_FEATURES: Record<string, string[]> = {
  free: [],
  plus: [FEATURE_KEYS.grammarBreakdown, FEATURE_KEYS.clarification],
  pro: [FEATURE_KEYS.grammarBreakdown, FEATURE_KEYS.clarification, FEATURE_KEYS.pronunciation],
};

function plan(name: string, priceUsdCents: number | null, overrides: Partial<PlanLimitConfig> = {}): PlanLimitConfig {
  return {
    name,
    label: name === "free" ? "Free" : name === "plus" ? "Plus" : "Pro",
    translationLimit: name === "free" ? 10 : null,
    creditCost: 1,
    videoLimit: name === "free" ? 0 : null,
    videoWindow: name === "free" ? "none" : "monthly",
    priceUsdCents,
    isActive: true,
    isDefault: name === "free",
    ...overrides,
  };
}

const SEEDED_LADDER = [plan("free", null), plan("plus", 500), plan("pro", 1000)];

function createCtx(opts: { subscriptionPlan: string; plans?: PlanLimitConfig[] }) {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const ctx = {
    user: { id: 1, audienceGroup: "product", subscriptionPlan: opts.subscriptionPlan },
    chat: { id: 1 },
    session: {},
    reply,
    services: createServicesStub({
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
      } as unknown as ServiceContainer["userRepository"],
      settings: {
        ...createSettingsStub(),
        getPlanLimits: vi.fn().mockResolvedValue(opts.plans ?? SEEDED_LADDER),
      },
      featureAccess: {
        listFeatures: vi.fn().mockResolvedValue(new Set()),
        listPlanFeatures: vi.fn(async (name: string) => new Set(PLAN_FEATURES[name] ?? [])),
        checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: false }),
      } as unknown as ServiceContainer["featureAccess"],
    }),
  } as unknown as BotContext;
  return { ctx, reply };
}

/** Callback data of the buttons on the message the screen sent. */
function buttons(reply: ReturnType<typeof vi.fn>): string[] {
  const markup = reply.mock.calls.at(-1)?.[1]?.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

const text = (reply: ReturnType<typeof vi.fn>): string => String(reply.mock.calls.at(-1)?.[0] ?? "");

describe("upgrade screen", () => {
  it("offers a Plus subscriber only the rung above, still written as a diff from Plus", async () => {
    const { ctx, reply } = createCtx({ subscriptionPlan: "plus" });

    await sendUpgradeScreen(ctx, "en", FEATURE_KEYS.pronunciation);

    expect(buttons(reply)).toEqual(["plan:buy:pro"]);
    // Plus is gone from the offer, but survives as the baseline the Pro block diffs against.
    expect(text(reply)).not.toContain("$5");
    expect(text(reply)).toContain("Everything in Plus");
    expect(text(reply)).toContain("Word audio");
  });

  it("opens with the feature that refused the tap and the cheapest plan carrying it", async () => {
    const { ctx, reply } = createCtx({ subscriptionPlan: "free" });

    await sendUpgradeScreen(ctx, "en", FEATURE_KEYS.pronunciation);

    // Named as Pro even though the cheaper Plus rung is still on offer below.
    expect(text(reply)).toContain("Word audio is a <b>Pro</b> feature");
    expect(buttons(reply)).toEqual(["plan:buy:plus", "plan:buy:pro"]);
  });

  it("falls back to the generic prompt when no feature refused the tap", async () => {
    const { ctx, reply } = createCtx({ subscriptionPlan: "free" });

    await sendUpgradeScreen(ctx, "en");

    expect(text(reply)).toContain("Upgrade your plan");
    expect(text(reply)).not.toContain("feature.");
  });

  it("tells a top-plan subscriber everything is unlocked instead of showing an empty menu", async () => {
    const { ctx, reply } = createCtx({ subscriptionPlan: "pro" });

    await sendUpgradeScreen(ctx, "en", FEATURE_KEYS.pronunciation);

    expect(text(reply)).toContain("already on the top plan");
    expect(buttons(reply)).toEqual([]);
  });

  it("stays calm when no plan is priced yet — a catalogue state the user did not cause", async () => {
    const { ctx, reply } = createCtx({
      subscriptionPlan: "free",
      plans: [plan("free", null), plan("plus", null), plan("pro", null)],
    });

    await sendUpgradeScreen(ctx, "en", FEATURE_KEYS.pronunciation);

    expect(text(reply)).toContain("coming to the paid plans soon");
    expect(text(reply)).not.toContain("⚠️");
    expect(buttons(reply)).toEqual([]);
  });
});
