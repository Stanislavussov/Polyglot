import { describe, expect, it, vi } from "vitest";
import type { CloseAndClaimResult, ProgressRepository } from "../../../ports/progress.repository.js";
import { DEFAULT_MOTIVATION_CONFIG, type MotivationConfig } from "../momentum.types.js";
import { createProgressService } from "../progress.service.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const NOTHING_CLOSED: CloseAndClaimResult = { closedMonths: [], countedMonths: 2, granted: [], deferredCycles: [] };

function fakeRepo(overrides: Partial<ProgressRepository> = {}): ProgressRepository {
  return {
    closeAndClaim: vi.fn(async () => NOTHING_CLOSED),
    getLedger: vi.fn(async () => []),
    listActivityEvents: vi.fn(async () => []),
    claimMilestones: vi.fn(async (_userId, milestones) => [...milestones]),
    listActiveUserIds: vi.fn(async () => []),
    listUsersToClose: vi.fn(async () => []),
    ...overrides,
  };
}

function serviceWith(repo: ProgressRepository, flags: Partial<MotivationConfig> = { progressGoalsEnabled: true }) {
  return createProgressService({
    progressRepository: repo,
    getMotivationConfig: async () => ({ ...DEFAULT_MOTIVATION_CONFIG, ...flags }),
    getTimezone: async () => "UTC",
    countMatureWords: async () => 44,
    now: () => NOW,
  });
}

describe("progressService.getProgressView", () => {
  it("is null and touches nothing while the ladder is hidden", async () => {
    const repo = fakeRepo();

    expect(await serviceWith(repo, {}).getProgressView(1)).toBeNull();
    expect(repo.closeAndClaim).not.toHaveBeenCalled();
  });

  it("builds the month, day, week and milestone from the live journal", async () => {
    const reviews = Array.from({ length: 5 }, (_, index) => ({
      kind: "review",
      occurredAt: new Date(NOW.getTime() - index * 60_000),
    }));
    const repo = fakeRepo({
      listActivityEvents: vi.fn(async () => [
        ...reviews,
        { kind: "save", occurredAt: new Date("2026-11-07T10:00:00.000Z") },
        { kind: "translate", occurredAt: new Date("2026-11-06T10:00:00.000Z") },
      ]),
    });

    const view = await serviceWith(repo).getProgressView(1);

    expect(view).toMatchObject({
      countedMonths: 2,
      monthsForReward: 5,
      cycleMonths: 2,
      month: { activeDays: 2, matureGained: 0, savedGained: 1, counted: false, minActiveDays: 12, minNewWords: 10 },
      milestone: { target: 50, remaining: 6 },
      day: { done: true, reviews: 5, target: 5 },
      week: { met: false, days: 2, target: 4 },
      goal: "week",
      freshRewards: [],
    });
    expect(repo.claimMilestones).toHaveBeenCalledWith(1, [10], NOW);
  });

  it("hands a reward granted by this very call to the screen", async () => {
    const grant = { cycle: 1, plan: "plus", action: "create" as const, days: 30, currentPeriodEnd: NOW };
    const repo = fakeRepo({
      closeAndClaim: vi.fn(async () => ({ ...NOTHING_CLOSED, countedMonths: 5, granted: [grant] })),
    });

    const view = await serviceWith(repo).getProgressView(1);

    expect(view?.freshRewards).toEqual([grant]);
    expect(view?.cycleMonths).toBe(0);
  });
});

describe("progressService.closeForUser", () => {
  it("closes months while hidden but grants nothing", async () => {
    const repo = fakeRepo();

    await serviceWith(repo, {}).closeForUser(1);

    expect(repo.closeAndClaim).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, grant: false }));
  });

  it("never grants from a backfill", async () => {
    const repo = fakeRepo();

    await serviceWith(repo).closeForUser(1, "backfill");

    expect(repo.closeAndClaim).toHaveBeenCalledWith(expect.objectContaining({ grant: false, source: "backfill" }));
  });
});
