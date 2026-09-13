import { DEFAULT_DAILY_CREDIT_CEILING } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { AI_CALL_WEIGHTS, type AiCallType, ensureAiQuota, recordAiUsage } from "./ai-quota.js";

interface CtxOptions {
  /** Plan limits as the admin panel would have them. `translationLimit: null` = an unlimited tier. */
  plan?: Record<string, unknown>;
  audienceGroup?: string;
}

function createCtx(usedCredits: number, options: CtxOptions = {}) {
  const getUserCreditsInWindow = vi.fn().mockResolvedValue(usedCredits);
  const logTranslationRequest = vi.fn().mockResolvedValue(1);
  const reply = vi.fn().mockResolvedValue({ message_id: 77 });
  const ctx = {
    user: { id: 1, subscriptionPlan: "free", audienceGroup: options.audienceGroup ?? "product" },
    reply,
    services: {
      productEventRepository: { record: vi.fn().mockResolvedValue(undefined) },
      translationRequestRepository: { getUserCreditsInWindow, logTranslationRequest },
      settings: {
        getPlanLimit: vi.fn().mockResolvedValue({
          name: "free",
          label: "Free",
          translationLimit: 50,
          creditCost: 1,
          isActive: true,
          isDefault: true,
          ...options.plan,
        }),
      },
    },
  } as unknown as BotContext;
  return { ctx, getUserCreditsInWindow, logTranslationRequest, reply };
}

/** A tier that sells "unlimited" — nothing but the safety ceiling bounds it. */
const UNLIMITED_PLAN = { name: "pro", label: "Pro", translationLimit: null, dailyCreditCeiling: null };

describe("ensureAiQuota (T16)", () => {
  it("charges the per-call-type weight for an allowed call", async () => {
    const { ctx } = createCtx(0);
    // Free plan = 50 credits/day; each of these fits.
    expect(await ensureAiQuota(ctx, "free", "en", "translate")).toBe(AI_CALL_WEIGHTS.translate);
    expect(await ensureAiQuota(ctx, "free", "en", "mentor")).toBe(AI_CALL_WEIGHTS.mentor);
    expect(await ensureAiQuota(ctx, "free", "en", "video")).toBe(AI_CALL_WEIGHTS.video);
  });

  it("weights are ordered so heavier calls cost more", () => {
    expect(AI_CALL_WEIGHTS.mentor).toBeGreaterThan(AI_CALL_WEIGHTS.translate);
    expect(AI_CALL_WEIGHTS.video).toBeGreaterThan(AI_CALL_WEIGHTS.mentor);
  });

  it("refuses and replies when the daily quota is exhausted", async () => {
    // 49 used + a mentor call (weight 2) = 51 > 50 free limit.
    const { ctx, reply } = createCtx(49);

    const result = await ensureAiQuota(ctx, "free", "en", "mentor");

    expect(result).toBeNull();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("still allows a call that exactly reaches the limit", async () => {
    // 49 used + a translate call (weight 1) = 50 = free limit.
    const { ctx, reply } = createCtx(49);

    const result = await ensureAiQuota(ctx, "free", "en", "translate");

    expect(result).toBe(1);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("ensureAiQuota — the daily safety ceiling", () => {
  it("lets an unlimited plan run right up to the ceiling", async () => {
    const { ctx, reply } = createCtx(DEFAULT_DAILY_CREDIT_CEILING - 1, { plan: UNLIMITED_PLAN });

    expect(await ensureAiQuota(ctx, "pro", "en", "translate")).toBe(1);
    expect(reply).not.toHaveBeenCalled();
  });

  it("stops an unlimited plan at the ceiling, where nothing else would have", async () => {
    const { ctx, reply } = createCtx(DEFAULT_DAILY_CREDIT_CEILING, { plan: UNLIMITED_PLAN });

    expect(await ensureAiQuota(ctx, "pro", "en", "translate")).toBeNull();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("refuses without offering an upgrade — there is nothing above the tier to sell", async () => {
    const { ctx, reply } = createCtx(DEFAULT_DAILY_CREDIT_CEILING, { plan: UNLIMITED_PLAN });

    await ensureAiQuota(ctx, "pro", "en", "translate");

    const [, options] = reply.mock.calls[0] as [string, { reply_markup?: unknown } | undefined];
    expect(options?.reply_markup).toBeUndefined();
  });

  it("caps an internal role too, which every other plan limit exempts", async () => {
    // A runaway loop on a staff account spends the same money as one on a
    // subscriber's, so this is the single limit `isUnlimitedRole` does not skip.
    const { ctx, reply } = createCtx(DEFAULT_DAILY_CREDIT_CEILING, { audienceGroup: "admin" });

    expect(await ensureAiQuota(ctx, "free", "en", "translate")).toBeNull();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("still lets an internal role work below the ceiling, unmetered by any plan", async () => {
    const { ctx, reply } = createCtx(60, { audienceGroup: "admin" });

    // 60 is past the 50-credit free plan, which an internal role rightly ignores.
    expect(await ensureAiQuota(ctx, "free", "en", "translate")).toBe(1);
    expect(reply).not.toHaveBeenCalled();
  });

  it("honours a plan that raises its own ceiling", async () => {
    // Expressed against the default rather than as a literal: pinning a number
    // that later became the default is exactly how this test once passed for the
    // wrong reason.
    const { ctx, reply } = createCtx(DEFAULT_DAILY_CREDIT_CEILING + 10, {
      plan: { ...UNLIMITED_PLAN, dailyCreditCeiling: DEFAULT_DAILY_CREDIT_CEILING * 2 },
    });

    expect(await ensureAiQuota(ctx, "pro", "en", "translate")).toBe(1);
    expect(reply).not.toHaveBeenCalled();
  });

  it("meets the plan's own limit first, so a metered user still gets the upgrade offer", async () => {
    // 50 used against a 50-credit free plan: both gates would refuse, and the one
    // that answers must be the one with something to sell.
    const { ctx, reply } = createCtx(50);

    expect(await ensureAiQuota(ctx, "free", "en", "translate")).toBeNull();
    const [, options] = reply.mock.calls[0] as [string, { reply_markup?: unknown } | undefined];
    expect(options?.reply_markup).toBeDefined();
  });
});

describe("recordAiUsage (T16)", () => {
  it("bills the given cost against the shared ledger, tagged by call type", async () => {
    const { ctx, logTranslationRequest } = createCtx(0);

    await recordAiUsage(ctx, "mentor" as AiCallType, 2, "cs", ["en"]);

    expect(logTranslationRequest).toHaveBeenCalledWith(1, "[mentor]", "cs", ["en"], 2);
  });
});
