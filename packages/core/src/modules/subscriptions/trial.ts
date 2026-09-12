/**
 * The onboarding reverse trial: every new account gets Plus for its first week,
 * then drops to free — see `@docs/tasks/84-onboarding-reverse-trial.md` for why
 * the shape is "a week of Plus" rather than "a day of everything".
 *
 * Three rules are load-bearing and encoded here rather than at the call sites:
 *
 *  - The tier is **Plus, not Pro.** A user cannot resent losing pronunciation or
 *    voice input they never had, and Pro has to keep something left to sell.
 *  - The gift is **once per account, forever.** The guard is the existence of a
 *    trial row in any status, so re-running onboarding can never re-grant it.
 *  - The ending is **announced before it happens, and earnable.** A user who
 *    saved {@link TRIAL_EXTENSION_WORDS} words during the week gets
 *    {@link TRIAL_EXTENSION_DAYS} more days once, which turns "it was taken
 *    away" into "I can keep it by using it".
 *
 * Nothing here renders text or touches Telegram: the module returns decisions,
 * the bot's `trial-lifecycle.wiring.ts` carries them out.
 */
import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import type { SubscriptionUserUpdater } from "./index.js";

/** `subscriptions.provider` marking a granted, never-billed period. */
export const TRIAL_PROVIDER = "trial";

/** The tier the first week runs on. */
export const TRIAL_PLAN = "plus";

export const TRIAL_DAYS = 7;
export const TRIAL_EXTENSION_DAYS = 3;

/** Words saved during the trial that earn the one extension. */
export const TRIAL_EXTENSION_WORDS = 10;

/**
 * How far from the end a warning becomes due — and therefore how far ahead the
 * sweep has to look.
 *
 * Two days, not one, because the sweep runs once a day: a trial ending at 23:00
 * UTC is more than 24 h away at the morning sweep and only an hour away at the
 * next one, so a 24 h window would reach most users with minutes left — too late
 * to act on the warning and too late to earn the extension, which becomes due in
 * the same window. At 48 h the first sweep that sees a trial is always 24–48 h
 * from its end, whatever hour it ends at. The copy names the end date rather
 * than a count of hours, since that 24-hour spread makes any number wrong for
 * most users — and a variable one breaks noun agreement in half the locales.
 */
export const TRIAL_WARNING_HOURS = 48;

/**
 * `notification_history.source` values for the three one-off trial messages.
 * Each row means "this user has been told this once"; the sweep reads them as
 * its own idempotence guard, so a re-run on the same day sends nothing twice.
 */
export const TRIAL_ENDING_SOURCE = "trial_ending";
/** The last warning, once the extension can no longer be earned. */
export const TRIAL_ENDING_FINAL_SOURCE = "trial_ending_final";
export const TRIAL_EXTENDED_SOURCE = "trial_extended";
export const TRIAL_ENDED_SOURCE = "trial_ended";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

export interface TrialGrantDeps {
  subscriptions: Pick<SubscriptionRepository, "create" | "findActiveByUser" | "findTrialByUser" | "updateStatus">;
  users: SubscriptionUserUpdater;
}

export type TrialGrant =
  | { granted: true; plan: string; days: number; currentPeriodEnd: Date }
  | { granted: false; reason: "already_trialled" | "has_subscription" };

/**
 * Hand a freshly onboarded user their week of Plus.
 *
 * Refuses in exactly two cases, and writes nothing in either: the account has
 * held a trial before, or it already has an active subscription (a paying user
 * re-running onboarding must not be swapped onto Plus — that would be a
 * downgrade for a Pro subscriber).
 */
export async function grantOnboardingTrial(
  deps: TrialGrantDeps,
  userId: number,
  now: Date = new Date(),
): Promise<TrialGrant> {
  const previous = await deps.subscriptions.findTrialByUser(userId);
  if (previous) {
    return { granted: false, reason: "already_trialled" };
  }

  const active = await deps.subscriptions.findActiveByUser(userId);
  if (active) {
    return { granted: false, reason: "has_subscription" };
  }

  const currentPeriodEnd = addDays(now, TRIAL_DAYS);
  // The row comes first: if the plan pointer moved and the row write then
  // failed, the user would hold Plus with nothing to expire it. `createdAt` is
  // passed rather than left to the database so that it and `currentPeriodEnd`
  // share one clock — `hasBeenExtended` is the difference between them.
  const row = await deps.subscriptions.create({
    userId,
    plan: TRIAL_PLAN,
    currentPeriodEnd,
    provider: TRIAL_PROVIDER,
    externalId: null,
    createdAt: now,
  });

  try {
    await deps.users.updateSubscriptionPlan(userId, TRIAL_PLAN);
  } catch (err) {
    // The pointer never took, so the user never held this trial. Retiring the
    // row keeps the lifecycle sweep from closing a week they never had — while
    // `findTrialByUser` still finds it, so the once-per-account gift stays spent
    // rather than being handed out twice.
    await deps.subscriptions.updateStatus(row.id, "canceled");
    throw err;
  }

  return { granted: true, plan: TRIAL_PLAN, days: TRIAL_DAYS, currentPeriodEnd };
}

/**
 * Which trial messages this user has already been sent. Delivery history only —
 * whether the extension itself was *granted* is a fact about the ledger
 * ({@link hasBeenExtended}), never about whether its message got through.
 */
export interface TrialNotified {
  /** The warning that still offers the extension. */
  warned: boolean;
  /** The final warning, sent when there is no extension left to earn. */
  warnedFinal: boolean;
  ended: boolean;
}

export type TrialAction =
  | { kind: "extend"; newPeriodEnd: Date }
  /**
   * `canEarn` is false once the extension has been spent: the warning must not
   * offer a deal the sweep will refuse to honour a day later. The two variants
   * are also delivered under different history sources, so a user warned before
   * earning their extension is still warned again before the new end.
   */
  | { kind: "warn"; endsAt: Date; canEarn: boolean }
  | { kind: "end" }
  | { kind: "skip" };

export interface TrialActionInput {
  currentPeriodEnd: Date;
  now: Date;
  /** `momentum_events` of kind `save` recorded since the trial started. */
  wordsSaved: number;
  /** Whether the one extension has already been granted — read off the ledger. */
  extended: boolean;
  notified: TrialNotified;
}

/**
 * What the sweep owes one trial row right now.
 *
 * The extension is checked before the warning, so an engaged user is never told
 * "this ends tomorrow" in the same breath as being given three more days. Both
 * "has it been extended" and "has it ended" come from the ledger; the history
 * rows only ever answer "was this message already sent", which is why a send
 * that failed cannot buy a second extension.
 */
export function decideTrialAction(input: TrialActionInput): TrialAction {
  const { currentPeriodEnd, now, wordsSaved, extended, notified } = input;

  if (currentPeriodEnd.getTime() <= now.getTime()) {
    return notified.ended ? { kind: "skip" } : { kind: "end" };
  }

  const hoursLeft = (currentPeriodEnd.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursLeft > TRIAL_WARNING_HOURS) {
    return { kind: "skip" };
  }

  if (!extended && wordsSaved >= TRIAL_EXTENSION_WORDS) {
    return { kind: "extend", newPeriodEnd: addDays(currentPeriodEnd, TRIAL_EXTENSION_DAYS) };
  }

  const alreadyWarned = extended ? notified.warnedFinal : notified.warned;
  return alreadyWarned ? { kind: "skip" } : { kind: "warn", endsAt: currentPeriodEnd, canEarn: !extended };
}

/**
 * Start of the window a metered plan is billed over: the calendar month, unless
 * the user's trial ended inside it — then the window starts there instead.
 *
 * The trial is unmetered, but every translation still lands in the same ledger,
 * so billing the plain calendar month would charge a downgraded user for their
 * whole unlimited week and refuse the first free translation they try. That is
 * the exact cliff the trial exists to avoid, so their free month begins where
 * the trial ended.
 *
 * A trial end still in the future (a live trial on an account whose plan pointer
 * says otherwise) yields a window that has not started, i.e. nothing counted —
 * which is the right answer for a user who is owed an unmetered week.
 */
export function resolveMeteredWindowStart(monthStart: Date, trialEnd: Date | null | undefined): Date {
  return trialEnd && trialEnd.getTime() > monthStart.getTime() ? trialEnd : monthStart;
}

/**
 * Whether this trial's one extension has already been granted — the ledger fact,
 * read off the period the row actually carries rather than off whether the
 * congratulation reached Telegram. A transiently failed send used to leave the
 * extension looking unspent, and the sweep then granted another three days every
 * time the row came back around: free Plus without end.
 *
 * Exact by construction: `grantOnboardingTrial` writes both timestamps from one
 * clock. Raising {@link TRIAL_DAYS} while trials are in flight would let each of
 * those rows earn one more extension, since their period was measured against
 * the old length. Bounded to one, and cheaper than a column for a boolean.
 */
export function hasBeenExtended(sub: Pick<Subscription, "createdAt" | "currentPeriodEnd">): boolean {
  return sub.currentPeriodEnd.getTime() > addDays(sub.createdAt, TRIAL_DAYS).getTime();
}

/** True when this row is the onboarding trial rather than a bought subscription. */
export function isTrial(sub: Pick<Subscription, "provider">): boolean {
  return sub.provider === TRIAL_PROVIDER;
}
