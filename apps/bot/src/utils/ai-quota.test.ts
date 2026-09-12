import { NON_TRANSLATION_LEDGER_TAGS } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { AI_CALL_WEIGHTS, type AiCallType, ensureAiQuota, recordAiUsage } from "./ai-quota.js";

function createCtx(usedCredits: number) {
  const getUserCreditsInWindow = vi.fn().mockResolvedValue(usedCredits);
  const logTranslationRequest = vi.fn().mockResolvedValue(1);
  const reply = vi.fn().mockResolvedValue({ message_id: 77 });
  const ctx = {
    user: { id: 1, subscriptionPlan: "free" },
    reply,
    services: {
      translationRequestRepository: { getUserCreditsInWindow, logTranslationRequest },
      settings: {
        getPlanLimit: vi.fn().mockResolvedValue({
          name: "free",
          label: "Free",
          translationLimit: 50,
          creditCost: 1,
          isActive: true,
          isDefault: true,
        }),
      },
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

describe("which paid AI calls the monthly translation allowance bills", () => {
  /**
   * Every paid AI call writes a `[callType]` row into the shared ledger, and the
   * monthly translation allowance bills all of them except the ones listed in
   * `NON_TRANSLATION_LEDGER_TAGS`. That list is a deny-list on purpose: widening
   * it to "everything bracketed" would quietly lift the monthly ceiling off the
   * dictionary translation and the word picker, which free users reach.
   *
   * The map below is the decision, one entry per call type — a new `AiCallType`
   * fails the last assertion until its author makes that decision explicitly.
   */
  const billedToTheMonthlyAllowance: Record<AiCallType, boolean> = {
    translate: true,
    dictionaryTranslate: true,
    wordPick: true,
    mentor: true,
    video: true,
    etymology: true,
    // The one exception, and the reason the list exists: free holds the grammar
    // breakdown from Task 84 on, metered by the daily budget instead.
    grammar: false,
  };

  it("has a decision recorded for every call type", () => {
    expect(Object.keys(billedToTheMonthlyAllowance).sort()).toEqual(Object.keys(AI_CALL_WEIGHTS).sort());
  });

  it("excludes exactly the call types that are not translations", () => {
    for (const [callType, billed] of Object.entries(billedToTheMonthlyAllowance)) {
      expect(NON_TRANSLATION_LEDGER_TAGS.includes(`[${callType}]`)).toBe(!billed);
    }
  });
});
