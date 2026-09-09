/**
 * Recovery line — S3 of the motivation layer (Task 81, §2.2, Slice 3).
 *
 * One line prefixed to a translation card the first time a user comes back after a
 * pause of a week or more. It never names the pause: the copy carries a welcome and
 * the real "to review" count, and the gap in days goes to the log only (§7.3).
 *
 * The decision and its consumption are two calls on purpose. `markRecoveryShown` is
 * the one-shot, and burning it before `ctx.reply` resolves would spend a returning
 * user's single chance on a send that failed. So the caller resolves the prefix,
 * sends the card, and only then commits — deferred delivery (§2.2 S3), which is also
 * why `lastSeenAt` moves through `touchSeen`: it declines to advance the mark while a
 * decided-but-unshown line is pending.
 */
import { errorFields, logEvent, type SupportedLang, t } from "@polyglot/core";
import { motivationRecoveryShownCounter } from "../metrics.js";
import type { BotContext } from "../types.js";

export interface RecoveryPrefix {
  /** Ready-to-prepend copy. */
  text: string;
  /** Log-only (§2.2, rule 3: the user is never told how long they were away). */
  gapDays: number;
}

/**
 * Decide whether this card carries the recovery line, without consuming the one-shot.
 *
 * Returns `null` — and advances `lastSeenAt` — when no line is due. Every failure is
 * swallowed: a momentum outage must not cost the user their translation (§4.2).
 */
export async function resolveRecoveryPrefix(
  ctx: BotContext,
  lang: SupportedLang,
  now: Date,
): Promise<RecoveryPrefix | null> {
  try {
    const momentum = ctx.services.momentumService;
    const decision = await momentum.decideRecovery(ctx.user.id, now);
    if (!decision.show) {
      await momentum.touchSeen(ctx.user.id, now);
      return null;
    }
    const due = await ctx.services.vocabularyRepository.countDueForSrs(ctx.user.id, now);
    // "To review: 0" would be an invitation to nothing; the welcome stands alone instead.
    const text =
      due > 0 ? `${t("recoveryLine", lang)} ${t("recoveryDue", lang, { count: due })}` : t("recoveryLine", lang);
    return { text, gapDays: decision.gapDays };
  } catch (err) {
    logEvent("momentum.record_failed", { kind: "recovery", ...errorFields(err) }, "error");
    return null;
  }
}

/** The line reached the user: restart both the pause and the seven-day recovery cooldown. */
export async function commitRecovery(ctx: BotContext, gapDays: number, now: Date): Promise<void> {
  try {
    await ctx.services.momentumService.markRecoveryShown(ctx.user.id, now);
    motivationRecoveryShownCounter.inc();
    logEvent("momentum.recovery_shown", { gapDays });
  } catch (err) {
    logEvent("momentum.record_failed", { kind: "recovery", ...errorFields(err) }, "error");
  }
}
