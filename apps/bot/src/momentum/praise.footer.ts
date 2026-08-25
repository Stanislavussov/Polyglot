/**
 * Praise line — S2 of the motivation layer (Task 81, §2.2, Slice 4).
 *
 * One line appended to a card the user was going to receive anyway, and only when a
 * counted fact paid for it. The selector in core decides *which* fact and returns an
 * i18n key; this file gathers the evidence, renders the copy, and files the journal
 * token that makes "once per kind per day" and the weekly cap hold.
 *
 * Evidence timing on the translation card, which the acceptance criterion turns on:
 * the card is rendered BEFORE the user taps 💾, so the dictionary count read here is
 * the count as of the previous save. `previousDictionaryCount` is therefore left
 * unset — the selector then fires a milestone on an exact landing — and the praise
 * for the tenth word arrives on the NEXT translation card or on the `srsDone` screen,
 * whichever the user reaches first. That is what keeps ten saves to one line rather
 * than ten.
 */
import {
  errorFields,
  logEvent,
  MATURE_INTERVAL_DAYS,
  type PraiseEvidence,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { motivationPraiseCounter, motivationPraiseSuppressedCounter } from "../metrics.js";
import type { BotContext } from "../types.js";

/** Where the line rides. A bounded enum — it is a Prometheus label (§7.2). */
export type PraiseSurface = "translation_card" | "srs_done" | "flashcard_done";

/** Facts only the finishing session knows; the counted ones are read from the database here. */
export interface SessionPraiseEvidence {
  matureCrossedNow?: { entryWord?: string; translationId: number };
  hardWordRecalledToday?: boolean;
}

/**
 * Render the praise line for this surface, or `null` when none is owed.
 *
 * Suppression is a counted outcome, not an absence: every reason feeds
 * `bot_motivation_praise_suppressed_total`, because a selector that quietly praises
 * everything and one that quietly praises nothing look identical without it.
 */
export async function resolvePraiseLine(
  ctx: BotContext,
  lang: SupportedLang,
  surface: PraiseSurface,
  now: Date,
  session: SessionPraiseEvidence = {},
): Promise<string | null> {
  try {
    // The kill switch is read before the evidence, never after: two COUNT queries on
    // every rendered card are exactly what a switched-off surface must not cost (§4.6).
    if (!(await ctx.services.settings.getMotivationConfig()).praiseEnabled) {
      motivationPraiseSuppressedCounter.inc({ reason: "killswitch" });
      return null;
    }

    const momentum = ctx.services.momentumService;
    const [dictionaryCount, matureCount] = await Promise.all([
      ctx.services.vocabularyRepository.countByUser(ctx.user.id),
      ctx.services.vocabularyRepository.countMatureTranslations(ctx.user.id, MATURE_INTERVAL_DAYS),
    ]);
    const evidence: PraiseEvidence = { dictionaryCount, matureCount, ...session };

    const outcome = await momentum.decidePraise(ctx.user.id, evidence, now);
    if (!("decision" in outcome)) {
      motivationPraiseSuppressedCounter.inc({ reason: outcome.suppressed });
      return null;
    }

    // The journal row is the claim. A replayed update loses the race on the dedupe
    // key and stays silent rather than praising the same fact twice.
    if (!(await momentum.markPraiseShown(ctx.user.id, outcome.decision.kind, now))) return null;

    motivationPraiseCounter.inc({ kind: outcome.decision.kind, surface });
    const { band } = await momentum.getSnapshot(ctx.user.id, now);
    logEvent("momentum.praise_shown", { praiseKind: outcome.decision.kind, surface, band });
    return t(outcome.decision.i18nKey, lang, outcome.decision.params);
  } catch (err) {
    logEvent("momentum.record_failed", { kind: "praise", ...errorFields(err) }, "error");
    return null;
  }
}
