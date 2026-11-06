/**
 * The deploy-time backfill for `grammar_check_daily_limit`
 * (`grammar-check-limit-backfill.ts`, driven from `deploy.yml`).
 *
 * NULL means "unlimited" in that column, so the one thing this step must never do
 * is mistake an admin's explicit NULL for a never-configured plan — that would
 * silently re-cap a plan the admin opened up, on every deploy. Only the `-1`
 * sentinel the ADD COLUMN wrote may be replaced.
 *
 * The backfill is global and plan rows are shared across the lane, so the test
 * works on plans of its own (unique names, injected defaults) and asserts only
 * those rows.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { backfillGrammarCheckLimits, GRAMMAR_CHECK_LIMIT_UNSET } from "../repositories/grammar-check-limit-backfill.js";
import { rateLimitPlanRepository } from "../repositories/rate-limit-plan.repository.js";

async function arrangePlan(name: string, grammarCheckDailyLimit: number | null): Promise<void> {
  await rateLimitPlanRepository.upsert({
    name,
    label: name,
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "none",
    mentorDailyLimit: null,
    grammarCheckDailyLimit,
    dailyCreditCeiling: null,
    priceUsdCents: null,
    isActive: true,
    isDefault: false,
    aiModelId: null,
  });
}

async function limitOf(name: string): Promise<number | null | undefined> {
  return (await rateLimitPlanRepository.findByName(name))?.grammarCheckDailyLimit;
}

describe("grammar-check limit backfill (integration)", () => {
  it("fills only never-configured plans and leaves every admin choice — NULL included — alone, once", async () => {
    // Arrange
    const suffix = randomUUID().slice(0, 8);
    const capped = `gc-capped-${suffix}`;
    const open = `gc-open-${suffix}`;
    const custom = `gc-custom-${suffix}`;
    const adminUnlimited = `gc-admin-null-${suffix}`;
    const adminNumber = `gc-admin-12-${suffix}`;
    await arrangePlan(capped, GRAMMAR_CHECK_LIMIT_UNSET);
    await arrangePlan(open, GRAMMAR_CHECK_LIMIT_UNSET);
    await arrangePlan(custom, GRAMMAR_CHECK_LIMIT_UNSET);
    await arrangePlan(adminUnlimited, null);
    await arrangePlan(adminNumber, 12);
    const defaults = { [capped]: 7, [open]: null };

    try {
      // Act
      const first = await backfillGrammarCheckLimits(defaults, 3);

      // Assert — catalog plans get their default, an unknown plan the fallback.
      const mine = new Set([capped, open, custom, adminUnlimited, adminNumber]);
      expect(first.filter((row) => mine.has(row.plan)).sort((a, b) => a.plan.localeCompare(b.plan))).toEqual(
        [
          { plan: capped, limit: 7 },
          { plan: custom, limit: 3 },
          { plan: open, limit: null },
        ].sort((a, b) => a.plan.localeCompare(b.plan)),
      );
      expect(await limitOf(capped)).toBe(7);
      expect(await limitOf(open)).toBeNull();
      expect(await limitOf(custom)).toBe(3);
      // Admin-owned values are untouched: NULL stays unlimited, a number stays.
      expect(await limitOf(adminUnlimited)).toBeNull();
      expect(await limitOf(adminNumber)).toBe(12);

      // A second deploy writes nothing — including over the NULL it just wrote.
      const second = await backfillGrammarCheckLimits(defaults, 3);
      expect(second.filter((row) => mine.has(row.plan))).toEqual([]);
      expect(await limitOf(open)).toBeNull();
    } finally {
      // Cleanup — plan rows are global; leave none behind for other files' list reads.
      for (const name of [capped, open, custom, adminUnlimited, adminNumber]) {
        await rateLimitPlanRepository.delete(name);
      }
    }
  });
});
