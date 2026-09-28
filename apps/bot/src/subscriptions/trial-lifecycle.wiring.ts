/**
 * The trial lifecycle sweep (Task 84) — the half of the onboarding reverse trial
 * that runs after the user has stopped looking at onboarding.
 *
 * Three things are owed to a trial that is running out, and all three are one-off
 * per user, recorded in `notification_history` under the sources in
 * `@polyglot/core`'s trial module:
 *
 *  - **warn**, a day before the end, naming what is about to switch off. A
 *    downgrade the user was told about reads as a deadline; the same downgrade
 *    unannounced reads as a bait-and-switch, which is the difference between an
 *    expiring trial that converts and one that churns.
 *  - **extend**, once, for a user who saved enough words during the week. Earning
 *    the extension is what turns "it was taken away" into "I keep it by using
 *    it" — and it spends the expensive tiers on the users who actually engage.
 *  - **end**, leading with what stays free rather than what is gone, with the
 *    week's saved-word count as the concrete thing the user built.
 *
 * The sweep never assumes it is the one that noticed: the nightly renewal sweep
 * may already have expired the row (both paths end a trial identically), and the
 * history rows — not the row's status — are what keep a message from going twice.
 */

import {
  momentumRepository,
  notificationDeliveryRepository,
  notificationRepository,
  subscriptionRepository,
  userRepository,
} from "@polyglot/adapter-db";
import {
  createSubscriptionService,
  decideTrialAction,
  errorFields,
  formatLongDate,
  getTraceContext,
  hasBeenExtended,
  isSupported,
  logEvent,
  type MomentumRepository,
  newTraceId,
  runWithTrace,
  type ServiceContainer,
  type Subscription,
  type SupportedLang,
  TRIAL_ENDED_SOURCE,
  TRIAL_ENDING_FINAL_SOURCE,
  TRIAL_ENDING_SOURCE,
  TRIAL_EXTENDED_SOURCE,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  TRIAL_WARNING_HOURS,
  type TrialNotified,
  t,
} from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import cron from "node-cron";
import { notificationCounter } from "../metrics.js";
import { logDelivery, type NotificationDeliveryLog } from "../notifications/delivery-log.js";
import { renewalPaymentPort } from "../payment.js";
import { buildUpgradeKeyboard } from "../scenes/helpers/subscription.helper.js";
import { isPermanentDeliveryFailure } from "../utils/telegram-errors.js";

let sweepTask: cron.ScheduledTask | null = null;

/**
 * Daily at 10:20 UTC — inside waking hours for the EU/CIS bulk of the user base
 * and deliberately clear of the notification scheduler's on-the-hour and
 * half-hour windows, the activation nudge (09:40) and the telemetry retention
 * sweep (03:15), so a trial message never lands in the same tick as a fan-out.
 */
const TRIAL_SWEEP_CRON = "20 10 * * *";

/**
 * How far back the sweep looks for trials that have already ended — what keeps
 * the scan from growing with every trial the product has ever granted. The
 * history rows, not this window, are what stop a message going twice.
 *
 * The one thing it gives up: after an outage longer than this, a user whose
 * trial ended during it never gets the closing message. Their *entitlement* is
 * still correct — the nightly renewal sweep expires an overdue trial whatever
 * its age — so the cost is a courtesy message, not a user stuck on a plan they
 * no longer hold.
 */
const ENDED_LOOKBACK_DAYS = 30;

/**
 * The fixed status labels this module puts on `bot_notifications_total`,
 * enumerated here rather than passed as free-form strings at the call site —
 * that is what keeps the metric's cardinality bounded.
 *
 * `trial_failed` and `trial_blocked` are distinct for the same reason as their
 * activation-nudge twins: the first is transient and retried on the next sweep
 * (a rising rate means Telegram or the network is unhappy), the second is a
 * permanently undeliverable recipient who has been retired (a rising rate means
 * the cohort is churning, not that anything is broken).
 */
const TRIAL_STATUSES = [
  "trial_warned",
  "trial_warned_final",
  "trial_extended",
  "trial_ended",
  "trial_failed",
  "trial_blocked",
  "trial_skipped",
] as const;

type TrialStatus = (typeof TRIAL_STATUSES)[number];

function countTrial(status: TrialStatus): void {
  notificationCounter.inc({ status });
}

/** The subset of the container the sweep touches. */
export interface TrialSweepServices {
  subscriptionRepository: NonNullable<ServiceContainer["subscriptionRepository"]>;
  userRepository: Pick<
    ServiceContainer["userRepository"],
    "findById" | "getSettings" | "getTelegramIdById" | "updateSubscriptionPlan"
  >;
  notificationRepository: Pick<
    ServiceContainer["notificationRepository"],
    "hasSentFromSource" | "recordSentWord" | "disableNotifications"
  >;
  momentumRepository: Pick<MomentumRepository, "countEventsSince">;
  notificationDeliveryRepository: NotificationDeliveryLog;
}

/** The subset of the Telegram API the sweep touches. */
export type TrialSweepApi = Pick<Api<RawApi>, "sendMessage">;

interface TrialMessage {
  source: string;
  text: string;
  status: TrialStatus;
  /** Defaults to true — every message but the gift carries the upgrade CTA. */
  keyboard?: boolean;
}

/**
 * What a trial message is filed under in `notification_history.original`. The
 * column is `NOT NULL` and holds a word on the scheduled-notification path, so a
 * message that is not about a word carries its own source in brackets — the same
 * `[tag]` shape `recordAiUsage` writes into the request ledger, and the shape
 * `recordAiUsage` writes into the request ledger. Spelled once so the two writers
 * here cannot drift from it.
 */
function historyOriginal(source: string): string {
  return `[${source}]`;
}

async function readNotified(services: TrialSweepServices, userId: number): Promise<TrialNotified> {
  const [warned, warnedFinal, ended] = await Promise.all([
    services.notificationRepository.hasSentFromSource(userId, TRIAL_ENDING_SOURCE),
    services.notificationRepository.hasSentFromSource(userId, TRIAL_ENDING_FINAL_SOURCE),
    services.notificationRepository.hasSentFromSource(userId, TRIAL_ENDED_SOURCE),
  ]);
  return { warned, warnedFinal, ended };
}

/**
 * Whether a live row still speaks for the user.
 *
 * A trial whose plan-pointer write was lost is one the user never actually held,
 * so warning them about it would promise a week that was never granted. (The
 * grant retires such a row itself; this catches one written before that existed,
 * or a hard kill between the two statements.) An `expired` row is not checked
 * against the pointer: it is already `free` by then, and the closing message is
 * exactly what is still owed. A `canceled` row — the converted subscriber — is
 * refused by the caller before any query.
 */
async function stillTheirSubscription(services: TrialSweepServices, sub: Subscription): Promise<boolean> {
  if (sub.status !== "active") return true;
  return (await services.userRepository.findById(sub.userId))?.subscriptionPlan === sub.plan;
}

/** Interface language and timezone in one read — the warning renders a date. */
async function resolveDisplay(
  services: TrialSweepServices,
  userId: number,
): Promise<{ lang: SupportedLang; timeZone: string }> {
  const settings = await services.userRepository.getSettings(userId);
  const raw = settings?.interfaceLang ?? "en";
  return { lang: isSupported(raw) ? raw : "en", timeZone: settings?.timezone || "UTC" };
}

/**
 * The send can never succeed for this user — they blocked the bot, deactivated
 * their account, or the chat is gone. Spend the message anyway (the history row
 * is what keeps them out of the next sweep) and take them off the outbound paths,
 * exactly as the activation nudge retires its own cohort.
 */
async function retireUndeliverable(
  services: TrialSweepServices,
  userId: number,
  source: string,
  err: unknown,
): Promise<void> {
  await services.notificationRepository.recordSentWord(userId, historyOriginal(source), source);
  try {
    await services.notificationRepository.disableNotifications(userId);
  } catch (disableErr) {
    logEvent("trial.disable_notifications_failed", errorFields(disableErr), "error");
  }
  countTrial("trial_blocked");
  logEvent("trial.retired_undeliverable", { source, ...errorFields(err) }, "warn");
}

/**
 * Deliver one trial message and spend it. A transient failure throws so the
 * caller counts it as retryable and the user stays eligible for the next sweep;
 * a permanent one retires the recipient.
 */
async function deliver(
  api: TrialSweepApi,
  services: TrialSweepServices,
  userId: number,
  lang: SupportedLang,
  message: TrialMessage,
): Promise<void> {
  const telegramId = await services.userRepository.getTelegramIdById(userId);
  if (telegramId === null) {
    countTrial("trial_skipped");
    logEvent("trial.skipped", { reason: "no_chat_id", source: message.source });
    return;
  }

  let telegramMessageId: number;
  try {
    const sent = await api.sendMessage(
      telegramId,
      message.text,
      message.keyboard === false ? {} : { reply_markup: buildUpgradeKeyboard(lang) },
    );
    telegramMessageId = sent.message_id;
  } catch (err) {
    if (!isPermanentDeliveryFailure(err)) throw err;
    await retireUndeliverable(services, userId, message.source, err);
    return;
  }

  // Journaled before the claim write: that write can throw, and the message has already arrived.
  await logDelivery(services.notificationDeliveryRepository, {
    userId,
    kind: "trial",
    text: message.text,
    meta: { source: message.source },
    telegramMessageId,
  });
  await services.notificationRepository.recordSentWord(userId, historyOriginal(message.source), message.source);
  countTrial(message.status);
  logEvent("trial.message_sent", { source: message.source });
}

async function handleOne(
  api: TrialSweepApi,
  services: TrialSweepServices,
  endTrial: (sub: Subscription) => Promise<void>,
  sub: Subscription,
  now: Date,
): Promise<void> {
  // Cheapest exit first: a superseded row is refused on its own status, before
  // any query. That is every converted subscriber, on every sweep for a month.
  if (sub.status === "canceled") {
    countTrial("trial_skipped");
    logEvent("trial.skipped", { reason: "superseded_by_purchase" });
    return;
  }

  const notified = await readNotified(services, sub.userId);
  // The closing message is the last thing this trial is owed, so a user who has
  // it needs no further query for the rest of the lookback window.
  if (notified.ended) return;

  if (!(await stillTheirSubscription(services, sub))) {
    countTrial("trial_skipped");
    logEvent("trial.skipped", { reason: "plan_pointer_never_took", status: sub.status });
    return;
  }

  const wordsSaved = await services.momentumRepository.countEventsSince(sub.userId, "save", sub.createdAt);
  const action = decideTrialAction({
    currentPeriodEnd: sub.currentPeriodEnd,
    now,
    wordsSaved,
    extended: hasBeenExtended(sub),
    notified,
  });
  if (action.kind === "skip") return;

  const { lang, timeZone } = await resolveDisplay(services, sub.userId);

  if (action.kind === "extend") {
    // The row moves first: an extension the user was told about but that never
    // reached the ledger would take the tier away a day after promising three more.
    await services.subscriptionRepository.extend(sub.id, action.newPeriodEnd);
    await deliver(api, services, sub.userId, lang, {
      source: TRIAL_EXTENDED_SOURCE,
      status: "trial_extended",
      // No upgrade CTA on the one message that is pure good news.
      keyboard: false,
      text: t("trialExtended", lang, { extraDays: String(TRIAL_EXTENSION_DAYS) }),
    });
    return;
  }

  if (action.kind === "warn") {
    // A date, not a count of hours: the sweep first reaches a row anywhere
    // between one and two days from its end, so a fixed number would be a lie —
    // and a variable one breaks noun agreement in half the locales.
    const date = formatLongDate(action.endsAt, lang, timeZone);
    await deliver(api, services, sub.userId, lang, {
      source: action.canEarn ? TRIAL_ENDING_SOURCE : TRIAL_ENDING_FINAL_SOURCE,
      // Two labels, not one: a collapsed metric could not tell "nobody saved ten
      // words" from "the earn-more branch is never reached".
      status: action.canEarn ? "trial_warned" : "trial_warned_final",
      text: action.canEarn
        ? t("trialEndingSoon", lang, {
            date,
            words: String(TRIAL_EXTENSION_WORDS),
            extraDays: String(TRIAL_EXTENSION_DAYS),
          })
        : t("trialEndingFinal", lang, { date }),
    });
    return;
  }

  // Ended. Downgrading first is what makes the message true when the user reads
  // it; the renewal sweep may already have done it, and `endTrial` is a no-op on
  // a row it has closed.
  await endTrial(sub);

  await deliver(api, services, sub.userId, lang, {
    source: TRIAL_ENDED_SOURCE,
    status: "trial_ended",
    // A user who saved nothing gets the version without the tally: "you saved 0
    // words" is the one sentence in this message that could only discourage.
    text: wordsSaved > 0 ? t("trialEnded", lang, { saved: String(wordsSaved) }) : t("trialEndedEmpty", lang),
  });
}

/**
 * One sweep over every trial near or past its end. Exported so it can be driven
 * directly from tests and from a one-shot script.
 *
 * A per-user failure is contained: it is logged and counted, and the rest of the
 * batch still goes out.
 */
export async function runTrialLifecycleSweep(
  api: TrialSweepApi,
  services: TrialSweepServices,
  now: Date = new Date(),
): Promise<void> {
  const since = new Date(now.getTime() - ENDED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = new Date(now.getTime() + TRIAL_WARNING_HOURS * 60 * 60 * 1000);
  const rows = await services.subscriptionRepository.findTrialsEndingBetween(since, cutoff);
  if (rows.length === 0) return;

  // One service for the whole sweep: `endTrial` is the only method used and it
  // never touches the payment port, which is why the port is not a sweep dep.
  const { endTrial } = createSubscriptionService({
    payment: renewalPaymentPort(),
    subscriptions: services.subscriptionRepository,
    users: services.userRepository,
  });

  logEvent("trial.sweep_started", { rowCount: rows.length });
  const sweepTraceId = getTraceContext()?.traceId;
  for (const sub of rows) {
    await runWithTrace(
      {
        traceId: newTraceId(),
        source: "cron",
        jobName: "trial_lifecycle",
        userId: sub.userId,
        ...(sweepTraceId !== undefined && { parentTraceId: sweepTraceId }),
      },
      async () => {
        try {
          await handleOne(api, services, endTrial, sub, now);
        } catch (err) {
          countTrial("trial_failed");
          // No history row was written, so the message is retried on a later
          // sweep. The *grant* is never retried — `hasBeenExtended` reads the
          // ledger, so a failed congratulation cannot buy a second extension.
          logEvent("trial.send_failed", errorFields(err), "warn");
        }
      },
    );
  }
}

/**
 * Start the daily trial-lifecycle cron. Idempotent: a duplicate call while a job
 * is already scheduled is ignored.
 */
export function wireTrialLifecycle(api: Api<RawApi>): void {
  if (sweepTask) {
    logEvent("trial.schedule_duplicate_ignored", {}, "warn");
    return;
  }

  sweepTask = cron.schedule(TRIAL_SWEEP_CRON, () => {
    void runTrialLifecycleSweep(api, {
      subscriptionRepository,
      userRepository,
      notificationRepository,
      momentumRepository,
      notificationDeliveryRepository,
    }).catch((err) => {
      // Never let a failed sweep crash the process — it retries on the next tick.
      logEvent("trial.sweep_failed", errorFields(err), "error");
    });
  });
  logEvent("trial.scheduled", { schedule: TRIAL_SWEEP_CRON });
}

/** Stop the trial-lifecycle cron gracefully. */
export function stopTrialLifecycle(): void {
  if (sweepTask) {
    sweepTask.stop();
    sweepTask = null;
    logEvent("trial.scheduler_stopped", {});
  }
}
