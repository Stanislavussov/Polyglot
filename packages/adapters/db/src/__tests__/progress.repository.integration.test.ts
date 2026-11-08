/**
 * Goal-ladder ledger and reward claim — real-DB integration tests (plan
 * `progress-goal-ladder` rev 4, step 2).
 *
 * What is proven here only Postgres can prove: the first writer wins a month, the
 * frozen columns survive later edits of their sources, and two concurrent
 * `closeAndClaim` calls grant one reward because of the row lock and the claim
 * token's unique index. Every test owns its user, so parallel workers never meet.
 */
import { DEFAULT_PROGRESS_GOALS, type PlanDays } from "@polyglot/core";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { progressRepository } from "../repositories/progress.repository.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { momentumEvents, progressMonths, subscriptions, userLanguageSettings, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const config = { ...DEFAULT_PROGRESS_GOALS, enabled: true };

async function freshUser(timezone = "UTC"): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "progress-test" });
  await getDb()
    .insert(userLanguageSettings)
    .values({ userId: user.id, interfaceLang: "en", nativeLang: "ru", timezone });
  return user.id;
}

/** Twelve review days and one matured word: a counted month. */
async function seedCountedMonth(userId: number, month: string, activeDays = 12): Promise<void> {
  const rows: Array<typeof momentumEvents.$inferInsert> = Array.from({ length: activeDays }, (_, index) => ({
    userId,
    kind: "review",
    weight: 3,
    occurredAt: new Date(`${month}-${String(index + 2).padStart(2, "0")}T10:00:00.000Z`),
    dedupeKey: `seed:review:${month}:${index}`,
  }));
  rows.push({
    userId,
    kind: "mature",
    weight: 10,
    occurredAt: new Date(`${month}-05T11:00:00.000Z`),
    dedupeKey: `seed:mature:${month}`,
  });
  await getDb().insert(momentumEvents).values(rows);
}

/** Months older than the journal's window, as an earlier close would have left them. */
async function seedLedger(userId: number, months: string[], planDays: PlanDays): Promise<void> {
  await getDb()
    .insert(progressMonths)
    .values(
      months.map((month) => ({
        userId,
        month,
        tz: "UTC",
        activeDays: 15,
        matureGained: 2,
        savedGained: 3,
        counted: true,
        planDays,
        source: "live" as const,
        closedAt: NOW,
      })),
    );
}

const PRO_MONTH: PlanDays = { free: 0, plus: 0, pro: 30, trial: 0 };
const FREE_MONTH: PlanDays = { free: 30, plus: 0, pro: 0, trial: 0 };

/** Three old counted months plus September and October live: the fifth counted month. */
async function arrangeFifthMonth(userId: number, planDays: PlanDays = FREE_MONTH): Promise<void> {
  await seedLedger(userId, ["2026-04", "2026-05", "2026-06"], planDays);
  await seedCountedMonth(userId, "2026-09");
  await seedCountedMonth(userId, "2026-10");
}

function rowsOf(userId: number) {
  return getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
}

async function planOf(userId: number): Promise<string | undefined> {
  const [row] = await getDb().select({ plan: users.subscriptionPlan }).from(users).where(eq(users.id, userId));
  return row?.plan;
}

async function claimTokens(userId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ dedupeKey: momentumEvents.dedupeKey })
    .from(momentumEvents)
    .where(and(eq(momentumEvents.userId, userId), eq(momentumEvents.kind, "reward")));
  return rows.map((row) => row.dedupeKey).sort();
}

describe("progressRepository.closeAndClaim — month close", () => {
  it("closes each ended in-window month once, in the user's timezone, and skips empty ones", async () => {
    const userId = await freshUser("Europe/Prague");
    await seedCountedMonth(userId, "2026-09");

    const first = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });
    const second = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });

    expect(first.closedMonths).toEqual(["2026-09"]);
    expect(second.closedMonths).toEqual([]);
    const ledger = await progressRepository.getLedger(userId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      month: "2026-09",
      tz: "Europe/Prague",
      activeDays: 12,
      matureGained: 1,
      savedGained: 0,
      counted: true,
      source: "live",
    });
  });

  it("never rewrites a closed month after a timezone change or a later subscription extend", async () => {
    const userId = await freshUser("Europe/Prague");
    await seedCountedMonth(userId, "2026-09");
    const sub = await subscriptionRepository.create({
      userId,
      plan: "plus",
      provider: "mock",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    });
    await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });

    await getDb()
      .update(userLanguageSettings)
      .set({ timezone: "Asia/Tokyo" })
      .where(eq(userLanguageSettings.userId, userId));
    await subscriptionRepository.extend(sub.id, new Date("2027-01-01T00:00:00.000Z"));
    await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });

    const [month] = await progressRepository.getLedger(userId);
    expect(month?.tz).toBe("Europe/Prague");
    // Prague midnight on Sept 1 is Aug 31 22:00 UTC, before the row existed: 29 Plus days.
    expect(month?.planDays).toEqual({ free: 1, plus: 29, pro: 0, trial: 0 });
  });

  it("falls back to UTC on a garbage timezone", async () => {
    const userId = await freshUser("Mars/Olympus");
    await seedCountedMonth(userId, "2026-10");

    await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });

    expect((await progressRepository.getLedger(userId))[0]?.tz).toBe("UTC");
  });
});

describe("progressRepository.closeAndClaim — reward", () => {
  it("writes the ledger but grants nothing while the ladder is hidden", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId);

    const result = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: false });

    expect(result).toMatchObject({ countedMonths: 5, granted: [] });
    expect(await rowsOf(userId)).toEqual([]);
    expect(await claimTokens(userId)).toEqual([]);
  });

  it("gives a mostly-free learner a Plus month as a new reward row", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId);

    const result = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });

    expect(result.granted).toEqual([
      { cycle: 1, plan: "plus", action: "create", days: 30, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY_MS) },
    ]);
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "reward", plan: "plus", status: "active", createdAt: NOW });
    expect(await planOf(userId)).toBe("plus");
    expect(await claimTokens(userId)).toEqual(["reward:cycle:1"]);
  });

  it("grants exactly once when two closes race", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId, PRO_MONTH);

    const results = await Promise.all([
      progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true }),
      progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true }),
    ]);

    expect(results.flatMap((result) => result.granted)).toHaveLength(1);
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.plan).toBe("pro");
    expect(await claimTokens(userId)).toEqual(["reward:cycle:1"]);
  });

  it("extends an active mock row and keeps its plan", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId, PRO_MONTH);
    const end = new Date("2026-11-20T00:00:00.000Z");
    const sub = await subscriptionRepository.create({ userId, plan: "plus", provider: "mock", currentPeriodEnd: end });

    const result = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });

    expect(result.granted[0]).toMatchObject({ action: "extend", plan: "plus" });
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: sub.id,
      plan: "plus",
      currentPeriodEnd: new Date(end.getTime() + 30 * DAY_MS),
    });
  });

  it("replaces an active trial instead of extending it", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId);
    const trialEnd = new Date("2026-11-12T00:00:00.000Z");
    const trial = await subscriptionRepository.create({
      userId,
      plan: "pro",
      provider: "trial",
      createdAt: new Date("2026-11-05T00:00:00.000Z"),
      currentPeriodEnd: trialEnd,
    });

    const result = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });

    expect(result.granted[0]).toMatchObject({ action: "replace_trial", plan: "plus" });
    const rows = await rowsOf(userId);
    expect(rows.find((row) => row.id === trial.id)).toMatchObject({ status: "expired", currentPeriodEnd: trialEnd });
    expect(rows.find((row) => row.provider === "reward")).toMatchObject({
      status: "active",
      plan: "plus",
      currentPeriodEnd: new Date(trialEnd.getTime() + 30 * DAY_MS),
    });
    expect(await planOf(userId)).toBe("plus");
  });

  it("defers silently on a real billing row, once per cycle, and never touches the row", async () => {
    const userId = await freshUser();
    await arrangeFifthMonth(userId);
    const end = new Date("2026-12-01T00:00:00.000Z");
    await subscriptionRepository.create({ userId, plan: "pro", provider: "mollie", currentPeriodEnd: end });

    const first = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });
    const second = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });

    expect(first).toMatchObject({ granted: [], deferredCycles: [1] });
    expect(second).toMatchObject({ granted: [], deferredCycles: [] });
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "mollie", currentPeriodEnd: end });
    expect(await claimTokens(userId)).toEqual(["reward_deferred:cycle:1"]);
  });

  it("grants every cycle a jump skipped", async () => {
    const userId = await freshUser();
    await seedLedger(
      userId,
      ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
      FREE_MONTH,
    );
    await seedCountedMonth(userId, "2026-09");
    await seedCountedMonth(userId, "2026-10");

    const result = await progressRepository.closeAndClaim({ userId, now: NOW, config, grant: true });

    expect(result.granted.map((grant) => [grant.cycle, grant.action])).toEqual([
      [1, "create"],
      [2, "extend"],
    ]);
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 60 * DAY_MS));
  });
});

describe("progressRepository.claimMilestones", () => {
  it("claims each milestone once and keeps it after the count drops", async () => {
    const userId = await freshUser();

    expect((await progressRepository.claimMilestones(userId, [10, 50], NOW)).sort((a, b) => a - b)).toEqual([10, 50]);
    expect((await progressRepository.claimMilestones(userId, [10], NOW)).sort((a, b) => a - b)).toEqual([10, 50]);
  });
});
