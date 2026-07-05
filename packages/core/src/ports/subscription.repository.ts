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
}

export interface SubscriptionRepository {
  create(input: CreateSubscriptionInput): Promise<Subscription>;
  findActiveByUser(userId: number): Promise<Subscription | null>;
  /** Active subscriptions whose paid period has ended by `now` — the cron sweep set. */
  findExpired(now: Date): Promise<Subscription[]>;
  extend(id: number, newPeriodEnd: Date): Promise<void>;
  updateStatus(id: number, status: SubscriptionStatus): Promise<void>;
}
