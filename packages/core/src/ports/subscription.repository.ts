import type { SubscriptionPlan } from "./user.repository.js";

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";

export interface Subscription {
  id: number;
  userId: number;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  provider: string;
  externalId: string | null;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionInput {
  userId: number;
  plan: SubscriptionPlan;
  currentPeriodEnd: Date;
  provider?: string;
  externalId?: string | null;
  /**
   * Creation instant, when the caller needs it to come from the same clock as
   * `currentPeriodEnd`. Omitted, the database stamps `now()` — fine for a bought
   * subscription, but not for a trial: `hasBeenExtended` compares the two, and
   * mixing the application's clock with the database's turns that comparison
   * into "is this host ahead of that one".
   */
  createdAt?: Date;
}

export interface SubscriptionRepository {
  create(input: CreateSubscriptionInput): Promise<Subscription>;
  findActiveByUser(userId: number): Promise<Subscription | null>;
  /**
   * Any trial row this user has ever held, whatever its status. This is the
   * once-per-account guard for the onboarding trial, which is why it must not
   * filter on status: an expired or superseded trial still means the gift is
   * spent, or re-running onboarding would hand out Plus forever.
   */
  findTrialByUser(userId: number): Promise<Subscription | null>;
  /**
   * Trial rows whose period ends inside `[since, cutoff]` — the lifecycle sweep
   * set. Status is deliberately unfiltered: the renewal sweep may already have
   * expired a row before the lifecycle cron reaches it, and the closing message
   * is still owed to that user.
   */
  findTrialsEndingBetween(since: Date, cutoff: Date): Promise<Subscription[]>;
  /** Active subscriptions whose paid period has ended by `now` — the cron sweep set. */
  findExpired(now: Date): Promise<Subscription[]>;
  extend(id: number, newPeriodEnd: Date): Promise<void>;
  updateStatus(id: number, status: SubscriptionStatus): Promise<void>;
}
