/**
 * Momentum recording wiring (Task 81, §4.1–4.2). The channel-neutral part —
 * `creditEffort`, `withReviewRecording`, `recordMatureIfCrossed` — lives in core so
 * the web credits the same efforts.
 *
 * `logTranslationRequest` is deliberately NOT wrapped: its second caller,
 * `recordAiUsage`, bills every paid AI call (video, word-picker, mentor…), so a
 * wrapper would credit a translation for watching a video and double-credit a
 * mentor turn (§4.1).
 */
import { creditEffort, type RecordEffortInput, type RecordEffortResult } from "@polyglot/core";
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
