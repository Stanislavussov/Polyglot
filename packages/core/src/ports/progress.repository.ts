/**
 * Goal-ladder persistence: the `progress_months` ledger plus the reward claim.
 * Imported by path, not through `ports/index.ts` (CLAUDE.md rule 4).
 */
import type { ActivityEvent, PlanDays, ProgressGoalsConfig } from "../modules/momentum/progress-goals.js";

export interface ProgressMonth {
  month: string;
  tz: string;
  activeDays: number;
  matureGained: number;
  savedGained: number;
  counted: boolean;
  planDays: PlanDays;
  source: "live" | "backfill";
  closedAt: Date;
}

export interface CloseAndClaimInput {
  userId: number;
  now: Date;
  config: ProgressGoalsConfig;
  /** Off while the ladder is hidden: months still close, nothing is granted. */
  grant: boolean;
  source?: "live" | "backfill";
}

export interface RewardGrant {
  cycle: number;
  plan: string;
  action: "create" | "extend" | "replace_trial";
  currentPeriodEnd: Date;
}

export interface CloseAndClaimResult {
  closedMonths: string[];
  countedMonths: number;
  granted: RewardGrant[];
  /** Cycles deferred for the first time on this call (a real billing row is active). */
  deferredCycles: number[];
}

export interface ProgressRepository {
  /**
   * One transaction under a `FOR UPDATE` lock on the user row: close every ended,
   * fully in-retention month not yet in the ledger (first writer wins), then claim
   * each completed reward cycle and apply its grant only when the claim row landed.
   */
  closeAndClaim(input: CloseAndClaimInput): Promise<CloseAndClaimResult>;
  getLedger(userId: number): Promise<ProgressMonth[]>;
  listActivityEvents(userId: number, from: Date, to: Date): Promise<ActivityEvent[]>;
  /** Claims `milestone:<n>` tokens; returns every milestone this user has ever claimed. */
  claimMilestones(userId: number, milestones: ReadonlyArray<number>, at: Date): Promise<number[]>;
  /** Users with any learning event in `[from, to)` — the bounded set the daily close visits. */
  listActiveUserIds(from: Date, to: Date): Promise<number[]>;
}
