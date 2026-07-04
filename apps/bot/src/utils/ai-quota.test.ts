import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { AI_CALL_WEIGHTS, type AiCallType, ensureAiQuota, recordAiUsage } from "./ai-quota.js";

function createCtx(usedCredits: number) {
  const getUserCreditsInWindow = vi.fn().mockResolvedValue(usedCredits);
  const logTranslationRequest = vi.fn().mockResolvedValue(1);
  const reply = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    user: { id: 1, subscriptionPlan: "free" },
    reply,
    services: {
      translationRequestRepository: { getUserCreditsInWindow, logTranslationRequest },
      settings: { getPlanLimit: vi.fn().mockResolvedValue(null) },
    },
  } as unknown as BotContext;
  return { ctx, getUserCreditsInWindow, logTranslationRequest, reply };
}

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

describe("recordAiUsage (T16)", () => {
  it("bills the given cost against the shared ledger, tagged by call type", async () => {
    const { ctx, logTranslationRequest } = createCtx(0);

    await recordAiUsage(ctx, "mentor" as AiCallType, 2, "cs", ["en"]);

    expect(logTranslationRequest).toHaveBeenCalledWith(1, "[mentor]", "cs", ["en"], 2);
  });
});
