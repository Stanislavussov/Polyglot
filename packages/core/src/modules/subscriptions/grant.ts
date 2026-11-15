import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";
import { REWARD_PROVIDER } from "./trial.js";

/** Just the user-mutation the subscription lifecycle needs (kept narrow on purpose). */
export interface SubscriptionUserUpdater {
  updateSubscriptionPlan(userId: number, plan: SubscriptionPlan): Promise<unknown>;
}

export interface GrantDeps {
  subscriptions: SubscriptionRepository;
  users: SubscriptionUserUpdater;
}

export interface PaidPeriod {
  userId: number;
  plan: SubscriptionPlan;
  provider: string;
  externalId: string | null;
}

/** Add one calendar month (UTC). Date normalizes overflow (e.g. Jan 31 → Mar 3). */
export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/**
 * Open one paid month, whichever channel sold it. Supersedes any active row
 * (repeat buy, Plus→Pro upgrade) so a user never holds two concurrent ones.
 */
export async function grantPaidPeriod(deps: GrantDeps, period: PaidPeriod, now: Date): Promise<Subscription> {
  const existing = await deps.subscriptions.findActiveByUser(period.userId);
  if (existing) {
    await deps.subscriptions.updateStatus(existing.id, "canceled");
  }
  // A reward is days already earned: the bought month starts where they end, or buying would forfeit them.
  const periodStart =
    existing?.provider === REWARD_PROVIDER && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
  await deps.users.updateSubscriptionPlan(period.userId, period.plan);
  return deps.subscriptions.create({ ...period, currentPeriodEnd: addOneMonth(periodStart) });
}
