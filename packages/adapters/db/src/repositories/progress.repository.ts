import {
  type ActivityEvent,
  activityStats,
  type CloseAndClaimInput,
  type CloseAndClaimResult,
  cyclesToClaim,
  grantAction,
  isMonthCounted,
  logEvent,
  longestHeldPlan,
  monthBounds,
  monthKey,
  monthsBetween,
  type PlanInterval,
  type ProgressMonth,
  type ProgressRepository,
  planDaysForMonth,
  REWARD_PROVIDER,
  type RewardGrant,
  safeTimezone,
} from "@polyglot/core";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "../connection.js";
import { DEFAULT_RETENTION_DAYS } from "../retention.js";
import { momentumEvents, progressMonths, subscriptions, userLanguageSettings, users } from "../schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LEARNING_KINDS = ["review", "save", "mature"] as const;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Months that ended in the user's timezone and whose every day is still inside the
 * journal's retention window — an older month would be closed on a pruned journal
 * and recorded as uncounted forever.
 */
function closableMonths(now: Date, timezone: string): string[] {
  const cutoff = new Date(now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY);
  const current = monthKey(now, timezone);
  return monthsBetween(monthKey(cutoff, timezone), current).filter(
    (month) => monthBounds(month, timezone).start.getTime() >= cutoff.getTime(),
  );
}

/** A canceled or expired row stopped covering when it was retired, not at its stale period end. */
function toInterval(row: typeof subscriptions.$inferSelect): PlanInterval {
  const end =
    row.status === "active" || row.updatedAt.getTime() > row.currentPeriodEnd.getTime()
      ? row.currentPeriodEnd
      : row.updatedAt;
  return { plan: row.plan, provider: row.provider, start: row.createdAt, end };
}

async function findActive(tx: Tx, userId: number) {
  const rows = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.id))
    .limit(1);
  return rows[0] ?? null;
}

async function insertClaim(tx: Tx, userId: number, dedupeKey: string, now: Date): Promise<boolean> {
  const rows = await tx
    .insert(momentumEvents)
    .values({ userId, kind: "reward", weight: 0, occurredAt: now, dedupeKey })
    .onConflictDoNothing({ target: [momentumEvents.userId, momentumEvents.dedupeKey] })
    .returning({ id: momentumEvents.id });
  return rows.length > 0;
}

async function closeMonths(tx: Tx, input: CloseAndClaimInput, timezone: string): Promise<string[]> {
  const { userId, now, config } = input;
  const candidates = closableMonths(now, timezone);
  if (candidates.length === 0) return [];
  const existing = await tx
    .select({ month: progressMonths.month })
    .from(progressMonths)
    .where(and(eq(progressMonths.userId, userId), inArray(progressMonths.month, candidates)));
  const closed = new Set(existing.map((row) => row.month));
  const missing = candidates.filter((month) => !closed.has(month));
  if (missing.length === 0) return [];

  const from = monthBounds(missing[0] as string, timezone).start;
  const to = monthBounds(missing.at(-1) as string, timezone).end;
  const [events, subscriptionRows] = await Promise.all([
    tx
      .select({ kind: momentumEvents.kind, occurredAt: momentumEvents.occurredAt })
      .from(momentumEvents)
      .where(
        and(
          eq(momentumEvents.userId, userId),
          inArray(momentumEvents.kind, [...LEARNING_KINDS]),
          gte(momentumEvents.occurredAt, from),
          lt(momentumEvents.occurredAt, to),
        ),
      ),
    tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
  ]);
  const intervals = subscriptionRows.map(toInterval);

  const inserted: string[] = [];
  for (const month of missing) {
    const bounds = monthBounds(month, timezone);
    const stats = activityStats(events, timezone, bounds.start, bounds.end);
    // A month without a single learning event is not worth a row: it can never count.
    if (stats.activeDays === 0) continue;
    const rows = await tx
      .insert(progressMonths)
      .values({
        userId,
        month,
        tz: timezone,
        ...stats,
        counted: isMonthCounted(stats, config),
        planDays: planDaysForMonth(intervals, month, timezone),
        source: input.source ?? "live",
        closedAt: now,
      })
      .onConflictDoNothing({ target: [progressMonths.userId, progressMonths.month] })
      .returning({ month: progressMonths.month });
    if (rows.length > 0) inserted.push(month);
  }
  return inserted;
}

async function applyGrant(
  tx: Tx,
  input: CloseAndClaimInput,
  cycle: number,
  plan: "plus" | "pro",
  active: typeof subscriptions.$inferSelect | null,
): Promise<RewardGrant> {
  const { userId, now, config } = input;
  const rewardMs = config.rewardDays * MS_PER_DAY;
  const action = grantAction(active);

  if (action === "extend" && active) {
    const currentPeriodEnd = new Date(active.currentPeriodEnd.getTime() + rewardMs);
    await tx.update(subscriptions).set({ currentPeriodEnd, updatedAt: now }).where(eq(subscriptions.id, active.id));
    return { cycle, plan: active.plan, action, currentPeriodEnd };
  }

  let base = now;
  if (action === "replace_trial" && active) {
    base = active.currentPeriodEnd;
    await tx.update(subscriptions).set({ status: "expired", updatedAt: now }).where(eq(subscriptions.id, active.id));
  }
  const currentPeriodEnd = new Date(base.getTime() + rewardMs);
  await tx.insert(subscriptions).values({
    userId,
    plan,
    status: "active",
    provider: REWARD_PROVIDER,
    externalId: null,
    currentPeriodEnd,
    createdAt: now,
    updatedAt: now,
  });
  await tx.update(users).set({ subscriptionPlan: plan }).where(eq(users.id, userId));
  return { cycle, plan, action: action === "replace_trial" ? "replace_trial" : "create", currentPeriodEnd };
}

export const progressRepository: ProgressRepository = {
  async closeAndClaim(input: CloseAndClaimInput): Promise<CloseAndClaimResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const { userId, now, config } = input;
      // Serializes every close/claim for this user: a tap and the daily job racing
      // each other both see the other's ledger rows and claim tokens.
      const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      if (locked.length === 0) return { closedMonths: [], countedMonths: 0, granted: [], deferredCycles: [] };

      const settings = await tx
        .select({ timezone: userLanguageSettings.timezone })
        .from(userLanguageSettings)
        .where(eq(userLanguageSettings.userId, userId))
        .limit(1);
      const timezone = safeTimezone(settings[0]?.timezone);
      const closedMonths = await closeMonths(tx, input, timezone);

      const counted = await tx
        .select({ planDays: progressMonths.planDays })
        .from(progressMonths)
        .where(and(eq(progressMonths.userId, userId), eq(progressMonths.counted, true)))
        .orderBy(asc(progressMonths.month));
      const result: CloseAndClaimResult = {
        closedMonths,
        countedMonths: counted.length,
        granted: [],
        deferredCycles: [],
      };
      if (!input.grant) return result;

      for (const cycle of cyclesToClaim(counted.length, config.monthsForReward)) {
        const active = await findActive(tx, userId);
        if (grantAction(active) === "defer") {
          if (await insertClaim(tx, userId, `reward_deferred:cycle:${cycle}`, now)) {
            result.deferredCycles.push(cycle);
            logEvent("progress.reward_deferred", { userId, cycle, provider: active?.provider ?? null });
          }
          continue;
        }
        if (!(await insertClaim(tx, userId, `reward:cycle:${cycle}`, now))) continue;
        const months = counted.slice((cycle - 1) * config.monthsForReward, cycle * config.monthsForReward);
        const plan = longestHeldPlan(months.map((row) => row.planDays));
        result.granted.push(await applyGrant(tx, input, cycle, plan, active));
      }
      return result;
    });
  },

  async getLedger(userId: number): Promise<ProgressMonth[]> {
    const db = getDb();
    return db
      .select({
        month: progressMonths.month,
        tz: progressMonths.tz,
        activeDays: progressMonths.activeDays,
        matureGained: progressMonths.matureGained,
        savedGained: progressMonths.savedGained,
        counted: progressMonths.counted,
        planDays: progressMonths.planDays,
        source: progressMonths.source,
        closedAt: progressMonths.closedAt,
      })
      .from(progressMonths)
      .where(eq(progressMonths.userId, userId))
      .orderBy(asc(progressMonths.month));
  },

  async listActivityEvents(userId: number, from: Date, to: Date): Promise<ActivityEvent[]> {
    const db = getDb();
    return db
      .select({ kind: momentumEvents.kind, occurredAt: momentumEvents.occurredAt })
      .from(momentumEvents)
      .where(
        and(
          eq(momentumEvents.userId, userId),
          inArray(momentumEvents.kind, [...LEARNING_KINDS]),
          gte(momentumEvents.occurredAt, from),
          lt(momentumEvents.occurredAt, to),
        ),
      );
  },

  async claimMilestones(userId: number, milestones: ReadonlyArray<number>, at: Date): Promise<number[]> {
    const db = getDb();
    if (milestones.length > 0) {
      await db
        .insert(momentumEvents)
        .values(
          milestones.map((milestone) => ({
            userId,
            kind: "milestone" as const,
            weight: 0,
            occurredAt: at,
            dedupeKey: `milestone:${milestone}`,
          })),
        )
        .onConflictDoNothing({ target: [momentumEvents.userId, momentumEvents.dedupeKey] });
    }
    const rows = await db
      .select({ dedupeKey: momentumEvents.dedupeKey })
      .from(momentumEvents)
      .where(and(eq(momentumEvents.userId, userId), eq(momentumEvents.kind, "milestone")));
    return rows.map((row) => Number(row.dedupeKey.split(":")[1])).filter(Number.isFinite);
  },

  async listActiveUserIds(from: Date, to: Date): Promise<number[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ userId: momentumEvents.userId })
      .from(momentumEvents)
      .where(
        and(
          inArray(momentumEvents.kind, [...LEARNING_KINDS]),
          gte(momentumEvents.occurredAt, from),
          lt(momentumEvents.occurredAt, to),
        ),
      );
    return rows.map((row) => row.userId);
  },
};
