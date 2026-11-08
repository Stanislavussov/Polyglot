/**
 * Momentum recording shared by every channel (Task 81, §4.1–4.2): the bot and the web
 * credit the same efforts under the same dedupe keys, so a word saved on the web and
 * reviewed in the bot is one save and one review, never two.
 *
 * `mature` is a direct call rather than an `updateSrsState` wrapper because that port
 * method receives only `translationId`, so a wrapper would have to query the owning
 * user on every SRS rating.
 */
import { errorFields, logEvent } from "../../observability/events.js";
import type { MomentumService, RecordEffortInput, RecordEffortResult } from "./momentum.service.js";
import { EFFORT_WEIGHTS, MATURE_INTERVAL_DAYS } from "./momentum.types.js";

/**
 * Never rejects, and reports `null` when the credit failed — the guarantee §4.2 owes:
 * a momentum failure cannot fail a translation, a save or a review session.
 * `Promise.resolve().then(...)` rather than a bare try/catch so a *synchronous* throw
 * inside `record` is a rejection here too.
 */
export function creditEffort(momentum: MomentumService, effort: RecordEffortInput): Promise<RecordEffortResult | null> {
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
 * Wraps `logReview` so every review, whichever surface rated it, credits momentum.
 * The credit is awaited: callers that await `logReview` then observe the journal row on
 * return. `momentum` is a getter so a test that swaps the service is honoured.
 */
export function withReviewRecording<
  T extends { logReview(userId: number, entryId: number, sessionType: string): Promise<void> },
>(repository: T, momentum: () => MomentumService): T {
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
 * The `mature:<translationId>` dedupe key is what makes "once per word, ever" hold,
 * whatever the interval was before (§3.8). Returns whether THIS rating claimed it.
 */
export async function recordMatureIfCrossed(
  momentum: MomentumService,
  args: { userId: number; entryId: number; translationId: number; interval: number },
): Promise<boolean> {
  if (args.interval < MATURE_INTERVAL_DAYS) return false;
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
