/**
 * One-off backfill for `rate_limit_plans.grammar_check_daily_limit`.
 *
 * The plan catalog is admin-owned and the seed never touches an existing plan, so
 * the plans already on prod and dev get no value from `DEFAULT_PLAN_CATALOG`. NULL
 * means "unlimited" in this column, so the column was added with a `-1` default
 * instead: every pre-existing row reads as "never configured", which no write path
 * ever stores (the admin contract rejects negatives). This replaces exactly those
 * rows with the plan's default and leaves anything an admin has saved — a number
 * or an explicit NULL — alone.
 *
 * Driven by `apps/bot/src/backfill-grammar-check-limits.cli.ts` from `deploy.yml`.
 * Remove this module, the CLI and its deploy step once dev and production have each
 * run a deploy carrying them; then drop the column's `-1` default in a later
 * migration.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { rateLimitPlans } from "../schema.js";

/** The ADD COLUMN default — "this plan has never had a grammar-check limit". */
export const GRAMMAR_CHECK_LIMIT_UNSET = -1;

/** Mirrors `DEFAULT_PLAN_CATALOG` in `apps/admin-api/src/plan-catalog.ts`. `null` = unlimited. */
const GRAMMAR_CHECK_LIMIT_DEFAULTS: Readonly<Record<string, number | null>> = {
  free: 5,
  plus: 50,
  pro: null,
  unlimited: null,
};

/**
 * A plan the catalog does not know (one an admin created) gets the free allowance:
 * the cheap mistake is a cap the admin then raises, not an unbounded AI bill.
 */
const GRAMMAR_CHECK_LIMIT_FALLBACK = 5;

export interface GrammarCheckLimitBackfill {
  plan: string;
  limit: number | null;
}

/**
 * Fill every never-configured plan with its default. Idempotent in the data: the
 * `= -1` predicate stops matching a row once it is written, so a second run
 * writes nothing.
 */
export async function backfillGrammarCheckLimits(
  defaults: Readonly<Record<string, number | null>> = GRAMMAR_CHECK_LIMIT_DEFAULTS,
  fallback: number | null = GRAMMAR_CHECK_LIMIT_FALLBACK,
): Promise<GrammarCheckLimitBackfill[]> {
  const db = getDb();
  const unset = await db
    .select({ name: rateLimitPlans.name })
    .from(rateLimitPlans)
    .where(eq(rateLimitPlans.grammarCheckDailyLimit, GRAMMAR_CHECK_LIMIT_UNSET));

  const filled: GrammarCheckLimitBackfill[] = [];
  for (const { name } of unset) {
    const limit = name in defaults ? (defaults[name] ?? null) : fallback;
    // Re-checks the sentinel in the WHERE so an admin save landing between the
    // select and this update is never overwritten.
    const updated = await db
      .update(rateLimitPlans)
      .set({ grammarCheckDailyLimit: limit })
      .where(and(eq(rateLimitPlans.name, name), eq(rateLimitPlans.grammarCheckDailyLimit, GRAMMAR_CHECK_LIMIT_UNSET)))
      .returning({ name: rateLimitPlans.name });
    if (updated.length > 0) filled.push({ plan: name, limit });
  }
  return filled;
}
