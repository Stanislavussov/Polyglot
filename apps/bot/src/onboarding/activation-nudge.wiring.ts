/**
 * D+1 activation nudge (Task 72, slice 8).
 *
 * A user who finishes onboarding and then never translates anything is the
 * cohort the redesign is aimed at, and the only thing left to do for them is ask
 * once. This schedules a single in-process daily cron — the same shape as
 * `retention.wiring.ts` — that finds those users and sends them one message with
 * a tap-to-see-card button.
 *
 * It is a one-off, not a series: the delivery is written to `notification_history`
 * under {@link ACTIVATION_NUDGE_SOURCE}, and the eligibility query excludes
 * anyone who already has such a row. That row means "this user's single nudge is
 * spent" — normally because the send succeeded, and on a *permanent* delivery
 * failure because it can never succeed. A *transient* failure writes nothing, so
 * the user stays eligible for tomorrow's sweep.
 */

import { notificationRepository, userRepository } from "@polyglot/adapter-db";
import {
  ACTIVATION_NUDGE_SOURCE,
  type ActivationNudgeCandidate,
  errorFields,
  getHookWords,
  getTraceContext,
  isSupported,
  logEvent,
  newTraceId,
  runWithTrace,
  type ServiceContainer,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { type Api, InlineKeyboard, type RawApi } from "grammy";
import cron from "node-cron";
import { notificationCounter } from "../metrics.js";
import { isPermanentDeliveryFailure } from "../utils/telegram-errors.js";
import { buildNudgeCardCallback } from "./activation-nudge.callbacks.js";

/** Internal state for the running cron task. */
let nudgeTask: cron.ScheduledTask | null = null;

/**
 * Daily at 09:40 UTC — late morning across the EU/CIS bulk of the user base and
 * deliberately clear of both the telemetry retention sweep (`15 3 * * *`) and the
 * notification scheduler's on-the-hour/half-hour windows, so the nudge burst
 * never lands in the same tick as a scheduled-notification fan-out.
 */
const ACTIVATION_NUDGE_CRON = "40 9 * * *";

/**
 * The fixed status labels this module puts on `bot_notifications_total`. Kept
 * enumerated here rather than passed as free-form strings at the call site —
 * that is what keeps the metric's cardinality bounded.
 *
 * `nudge_failed` and `nudge_blocked` are deliberately distinct: the first is a
 * transient failure that will be retried tomorrow (a rising rate means Telegram
 * or the network is unhappy), the second is a permanently undeliverable
 * recipient who has been retired (a rising rate means the cohort is churning,
 * not that anything is broken). Collapsing them would hide both signals.
 */
const NUDGE_STATUSES = ["nudge_sent", "nudge_failed", "nudge_blocked", "nudge_skipped"] as const;

type NudgeStatus = (typeof NUDGE_STATUSES)[number];

function countNudge(status: NudgeStatus): void {
  notificationCounter.inc({ status });
}

/** The subset of the container the sweep touches. */
export type ActivationNudgeServices = Pick<ServiceContainer, "userRepository" | "notificationRepository">;

/** The subset of the Telegram API the sweep touches. */
export type ActivationNudgeApi = Pick<Api<RawApi>, "sendMessage">;

interface NudgeHook {
  sourceLang: string;
  index: number;
  headword: string;
}

/**
 * The hook word to nudge with: the first curated word of the first learning
 * language that has one. Deterministic on purpose — the same user always gets
 * the same word, so a retry after a failed send is not a different message.
 * Returns null when none of the user's learning languages has a curated set;
 * those users are skipped entirely rather than sent an empty nudge.
 */
function pickNudgeHook(learningLangs: readonly string[]): NudgeHook | null {
  for (const sourceLang of learningLangs) {
    const word = getHookWords(sourceLang)[0];
    if (word) return { sourceLang, index: 0, headword: word.headword };
  }
  return null;
}

/**
 * The send can never succeed for this user — they blocked the bot, deactivated
 * their account, or the chat is gone. Two things have to happen, and they are
 * separate on purpose:
 *
 * (a) Disable their notifications through the same repository call the
 *     notification scheduler makes on a blocked user (T14), so one blocked-user
 *     signal takes them off every outbound path rather than just this one.
 *
 * (b) Spend their nudge by writing the `notification_history` row, which is what
 *     actually keeps them out of tomorrow's sweep. This is NOT left to (a):
 *     `notification_enabled` already defaults to false for a user who never
 *     opted in — the overwhelming majority of this cohort — so for them the
 *     disable is a no-op and cannot be the thing that closes the loop.
 */
async function retireUndeliverable(
  services: ActivationNudgeServices,
  candidate: ActivationNudgeCandidate,
  headword: string,
  err: unknown,
): Promise<void> {
  await services.notificationRepository.recordSentWord(candidate.userId, headword, ACTIVATION_NUDGE_SOURCE);

  try {
    await services.notificationRepository.disableNotifications(candidate.userId);
  } catch (disableErr) {
    // The nudge is already retired by the history row above; a failed disable
    // only leaves the scheduled-notification path to notice on its own.
    logEvent("nudge.disable_notifications_failed", errorFields(disableErr), "error");
  }

  countNudge("nudge_blocked");
  logEvent("nudge.retired_undeliverable", errorFields(err), "warn");
}

async function nudgeOne(
  api: ActivationNudgeApi,
  services: ActivationNudgeServices,
  candidate: ActivationNudgeCandidate,
): Promise<void> {
  const hook = pickNudgeHook(candidate.learningLangs);
  if (!hook) {
    countNudge("nudge_skipped");
    logEvent("nudge.skipped", { reason: "no_hook_word", learningLangs: candidate.learningLangs });
    return;
  }

  const lang: SupportedLang = isSupported(candidate.interfaceLang) ? candidate.interfaceLang : "en";
  const keyboard = new InlineKeyboard().text(
    t("onbNudgeButton", lang),
    buildNudgeCardCallback(hook.sourceLang, hook.index),
  );

  try {
    await api.sendMessage(candidate.telegramId, t("onbNudgeMessage", lang, { word: hook.headword }), {
      reply_markup: keyboard,
    });
  } catch (err) {
    // Transient (network, 5xx, flood): rethrow so the sweep counts it as a
    // retryable failure and the user stays eligible tomorrow.
    if (!isPermanentDeliveryFailure(err)) throw err;
    await retireUndeliverable(services, candidate, hook.headword, err);
    return;
  }

  // Only now is the user's single nudge spent.
  await services.notificationRepository.recordSentWord(candidate.userId, hook.headword, ACTIVATION_NUDGE_SOURCE);
  countNudge("nudge_sent");
  logEvent("nudge.sent", { headword: hook.headword, sourceLang: hook.sourceLang });
}

/**
 * One sweep over the eligible cohort. Exported so it can be driven directly in
 * tests and, if it ever becomes useful, from a one-shot script.
 *
 * A per-user failure is contained: it is logged and counted, and the rest of the
 * batch still goes out.
 */
export async function runActivationNudgeSweep(
  api: ActivationNudgeApi,
  services: ActivationNudgeServices,
  now: Date = new Date(),
): Promise<void> {
  const candidates = await services.userRepository.findActivationNudgeCandidates(now);
  if (candidates.length === 0) return;

  logEvent("nudge.sweep_started", { candidateCount: candidates.length });
  const sweepTraceId = getTraceContext()?.traceId;
  for (const candidate of candidates) {
    // One trace per candidate, linked to the sweep, so a single undelivered
    // nudge is followable without reading the whole batch.
    await runWithTrace(
      {
        traceId: newTraceId(),
        source: "cron",
        jobName: "activation_nudge",
        userId: candidate.userId,
        ...(sweepTraceId !== undefined && { parentTraceId: sweepTraceId }),
      },
      async () => {
        try {
          await nudgeOne(api, services, candidate);
        } catch (err) {
          countNudge("nudge_failed");
          // No history row was written, so this user is picked up again tomorrow.
          logEvent("nudge.send_failed", errorFields(err), "warn");
        }
      },
    );
  }
}

/**
 * Start the daily activation-nudge cron job. Idempotent: a duplicate call while
 * a job is already scheduled is ignored.
 */
export function wireActivationNudge(api: Api<RawApi>): void {
  if (nudgeTask) {
    logEvent("nudge.schedule_duplicate_ignored", {}, "warn");
    return;
  }

  nudgeTask = cron.schedule(ACTIVATION_NUDGE_CRON, () => {
    void runActivationNudgeSweep(api, { userRepository, notificationRepository }).catch((err) => {
      // Never let a failed sweep crash the process — it retries on the next tick.
      logEvent("nudge.sweep_failed", errorFields(err), "error");
    });
  });
  logEvent("nudge.scheduled", { schedule: ACTIVATION_NUDGE_CRON });
}

/** Stop the activation-nudge cron job gracefully. */
export function stopActivationNudge(): void {
  if (nudgeTask) {
    nudgeTask.stop();
    nudgeTask = null;
    logEvent("nudge.scheduler_stopped", {});
  }
}
