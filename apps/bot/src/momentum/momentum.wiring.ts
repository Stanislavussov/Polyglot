/**
 * Momentum recording wiring (Task 81, §4.1–4.2).
 *
 * `logTranslationRequest` is deliberately NOT wrapped: its second caller,
 * `recordAiUsage`, bills every paid AI call (video, word-picker, mentor…), so a
 * wrapper would credit a translation for watching a video and double-credit a
 * mentor turn (§4.1).
 *
 * `mature` is a direct call rather than an `updateSrsState` wrapper — which the plan
 * preferred — because that port method receives only `translationId`, so a wrapper
 * would have to query the owning user on every SRS rating. `updateSrsState` has
 * exactly one production call site; a second one must call this helper too.
 */
import {
  EFFORT_WEIGHTS,
  errorFields,
  logEvent,
  MATURE_INTERVAL_DAYS,
  type MomentumService,
  type RecordEffortInput,
  type RecordEffortResult,
  type ServiceContainer,
} from "@polyglot/core";
import { getRequestSettings } from "../middlewares/request-settings.js";
import type { BotContext } from "../types.js";

/**
 * Credit one effort for the update being handled. Never rejects.
 *
 * The timezone rides along from the update's own settings memo: the service needs it
 * for the daily cap, and reading it here turns a `user_language_settings` SELECT per
 * credited effort into a share of the one this update already paid for.
 */
export function recordEffort(ctx: BotContext, effort: RecordEffortInput): Promise<RecordEffortResult | null> {
  return Promise.resolve()
    .then(() => getRequestSettings(ctx, effort.userId))
    .catch(() => null)
    .then((settings) =>
      creditEffort(ctx.services.momentumService, settings ? { ...effort, timezone: settings.timezone } : effort),
    );
}

/**
 * Never rejects, and reports `null` when the credit failed — the guarantee §4.2 owes:
 * a momentum failure cannot fail a translation, a save or a review session.
 * `Promise.resolve().then(...)` rather than a bare try/catch so a *synchronous* throw
 * inside `record` is a rejection here too, and every caller stays free to `void` or
 * `await` without its own error handling.
 */
function creditEffort(momentum: MomentumService, effort: RecordEffortInput): Promise<RecordEffortResult | null> {
  return Promise.resolve()
    .then(() => momentum.record(effort))
    .then((result) => {
      if (result.inserted) {
        logEvent(
          "momentum.effort_recorded",
          { kind: effort.kind, weight: result.weight, capped: result.weight < EFFORT_WEIGHTS[effort.kind] },
          "debug",
        );
      }
      return result;
    })
    .catch((err: unknown) => {
      logEvent("momentum.record_failed", { kind: effort.kind, ...errorFields(err) }, "error");
      return null;
    });
}

/**
 * The credit is awaited inside the wrapper (the plan sketched `void`): callers that
 * already await `logReview` then observe the journal row on return, which is what
 * makes the e2e assertion deterministic instead of racing the dispatch. Callers that
 * fire-and-forget (`logReviewSafe`) are unaffected — they still do not block.
 *
 * `momentum` is a getter, not a value, so a test that swaps `services.momentumService`
 * is honoured here as well as at the direct call sites.
 */
export function withReviewRecording(
  repository: ServiceContainer["wordReviewRepository"],
  momentum: () => MomentumService,
): ServiceContainer["wordReviewRepository"] {
  return {
    ...repository,
    async logReview(userId: number, entryId: number, sessionType: string): Promise<void> {
      await repository.logReview(userId, entryId, sessionType);
      await creditEffort(momentum(), {
        userId,
        kind: "review",
        dedupeKey: (localDay) => `review:${entryId}:${localDay}`,
      });
    },
  };
}

/**
 * No pre-read of the previous interval: the `mature:<translationId>` dedupe key is
 * what makes "once per word, ever" hold, whatever the interval was before (§3.8) —
 * which is also why the event is logged only on the insert that actually claimed it.
 *
 * Returns whether THIS rating claimed the crossing, the evidence the end-of-session
 * praise line stands on (§2.2 S2).
 */
export async function recordMatureIfCrossed(
  momentum: MomentumService,
  args: { userId: number; entryId: number; translationId: number; interval: number },
): Promise<boolean> {
  if (args.interval < MATURE_INTERVAL_DAYS) return false;
  // `mature` is uncapped, so the service needs no local day and no timezone for it.
  const result = await creditEffort(momentum, {
    userId: args.userId,
    kind: "mature",
    dedupeKey: `mature:${args.translationId}`,
  });
  if (!result?.inserted) return false;
  logEvent("momentum.mature_word", {
    entryId: args.entryId,
    translationId: args.translationId,
    interval: args.interval,
  });
  return true;
}
