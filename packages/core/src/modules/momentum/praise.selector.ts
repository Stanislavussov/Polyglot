/**
 * Praise selection — pure, evidence-first (§2.3). Praise is only ever earned by a
 * fact that already happened; there is no branch that congratulates a user for
 * showing up. The selector returns an i18n key, never a rendered string.
 */
import type { PraiseDecision, PraiseKind } from "./momentum.types.js";

export const PRAISE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** At most two praises per rolling week, counted from the `praise` rows in the journal (§3.8). */
export const PRAISE_WEEKLY_CAP = 2;

export type PraiseSuppressionReason = "cooldown" | "weekly_cap" | "killswitch" | "no_evidence";

/**
 * Outcome shape: a suppression is a *result*, not an absence, because every reason
 * feeds `bot_motivation_praise_suppressed_total{reason}` (§7.3). Narrow with
 * `"decision" in outcome`; there is no `null` return.
 */
export type PraiseOutcome = { decision: PraiseDecision } | { suppressed: PraiseSuppressionReason };

export interface PraiseEvidence {
  /** The translation whose SRS interval crossed the mature threshold in this very update. */
  matureCrossedNow?: { entryWord?: string; translationId: number } | null;
  dictionaryCount: number;
  /** Dictionary size before the action being praised; absent means only an exact landing on a milestone counts. */
  previousDictionaryCount?: number;
  hardWordRecalledToday?: boolean;
  matureCount: number;
}

export interface SelectPraiseInput {
  evidence: PraiseEvidence;
  lastPraiseAt: Date | null;
  praiseCountLast7d: number;
  now: Date;
}

const DICTIONARY_MILESTONES = [100, 50, 10] as const;

const MILESTONE_KINDS: Record<(typeof DICTIONARY_MILESTONES)[number], PraiseKind> = {
  10: "dictionary_10",
  50: "dictionary_50",
  100: "dictionary_100",
};

function selectMilestone(evidence: PraiseEvidence): PraiseDecision | null {
  const previous = evidence.previousDictionaryCount;
  for (const milestone of DICTIONARY_MILESTONES) {
    const crossed =
      previous === undefined
        ? evidence.dictionaryCount === milestone
        : previous < milestone && evidence.dictionaryCount >= milestone;
    if (crossed) {
      const kind = MILESTONE_KINDS[milestone];
      return { kind, i18nKey: `praiseDictionary${milestone}`, params: { count: evidence.dictionaryCount } };
    }
  }
  return null;
}

function selectEvidence(evidence: PraiseEvidence): PraiseDecision | null {
  // A word can only be reported as "stuck" while the user actually has stuck words —
  // the counter is read live from srsInterval, so a stale crossing must not slip past it.
  if (evidence.matureCrossedNow && evidence.matureCount > 0) {
    const word = evidence.matureCrossedNow.entryWord;
    return { kind: "mature_word", i18nKey: "praiseMatureWord", params: word ? { word } : {} };
  }
  const milestone = selectMilestone(evidence);
  if (milestone) return milestone;
  if (evidence.hardWordRecalledToday) {
    return { kind: "hard_word_recalled", i18nKey: "praiseHardWordRecalled", params: {} };
  }
  return null;
}

export function selectPraise(input: SelectPraiseInput): PraiseOutcome {
  if (input.lastPraiseAt && input.now.getTime() - input.lastPraiseAt.getTime() < PRAISE_COOLDOWN_MS) {
    return { suppressed: "cooldown" };
  }
  if (input.praiseCountLast7d >= PRAISE_WEEKLY_CAP) {
    return { suppressed: "weekly_cap" };
  }
  const decision = selectEvidence(input.evidence);
  return decision ? { decision } : { suppressed: "no_evidence" };
}
