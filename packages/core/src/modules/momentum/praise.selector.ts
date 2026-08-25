/**
 * Evidence-first (§2.3): praise is only ever earned by a fact that already happened,
 * so there is no branch that congratulates a user for showing up.
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
  /** Praise kinds this user has ever claimed, from the journal's `praise:*` dedupe keys. */
  praisedKinds: ReadonlySet<string>;
  now: Date;
}

/**
 * Milestones a user passes once in a lifetime. They are claimed by kind alone, and
 * the selector refuses to offer one twice: the evidence behind them ("you have ten
 * words") stays true forever, so nothing else would stop a user parked at exactly
 * ten words from being congratulated for it every week.
 */
const ONCE_EVER_KINDS: ReadonlySet<PraiseKind> = new Set([
  "dictionary_10",
  "dictionary_25",
  "dictionary_50",
  "dictionary_100",
  "first_mature",
]);

export function isOnceEverPraise(kind: PraiseKind): boolean {
  return ONCE_EVER_KINDS.has(kind);
}

/**
 * Descending, so the largest milestone a count satisfies wins. Kind and copy key are
 * carried literally rather than built as `praiseDictionary${n}`: a template string is
 * not an `I18nKey`, and the cast that would make it one is exactly what lets a typo
 * reach the user as a raw key.
 */
const DICTIONARY_MILESTONES = [
  { count: 100, kind: "dictionary_100", i18nKey: "praiseDictionary100" },
  { count: 50, kind: "dictionary_50", i18nKey: "praiseDictionary50" },
  { count: 25, kind: "dictionary_25", i18nKey: "praiseDictionary25" },
  { count: 10, kind: "dictionary_10", i18nKey: "praiseDictionary10" },
] as const satisfies ReadonlyArray<{ count: number; kind: PraiseKind; i18nKey: PraiseDecision["i18nKey"] }>;

function selectMilestone(evidence: PraiseEvidence): PraiseDecision | null {
  const previous = evidence.previousDictionaryCount;
  for (const milestone of DICTIONARY_MILESTONES) {
    const crossed =
      previous === undefined
        ? evidence.dictionaryCount === milestone.count
        : previous < milestone.count && evidence.dictionaryCount >= milestone.count;
    if (crossed) {
      return { kind: milestone.kind, i18nKey: milestone.i18nKey, params: { count: evidence.dictionaryCount } };
    }
  }
  return null;
}

/** Everything this evidence could pay for, best first. */
function candidateDecisions(evidence: PraiseEvidence): PraiseDecision[] {
  const candidates: PraiseDecision[] = [];
  // A word can only be reported as "stuck" while the user actually has stuck words —
  // the counter is read live from srsInterval, so a stale crossing must not slip past it.
  if (evidence.matureCrossedNow && evidence.matureCount > 0) {
    // The very first one is the milestone; naming the word only means something once
    // "a word of mine reached long-term memory" is no longer the news itself.
    if (evidence.matureCount === 1) {
      candidates.push({ kind: "first_mature", i18nKey: "praiseFirstMature", params: {} });
    } else {
      const word = evidence.matureCrossedNow.entryWord;
      candidates.push({ kind: "mature_word", i18nKey: "praiseMatureWord", params: word ? { word } : {} });
    }
  }
  const milestone = selectMilestone(evidence);
  if (milestone) candidates.push(milestone);
  if (evidence.hardWordRecalledToday) {
    candidates.push({ kind: "hard_word_recalled", i18nKey: "praiseHardWordRecalled", params: {} });
  }
  return candidates;
}

function selectEvidence(evidence: PraiseEvidence, praisedKinds: ReadonlySet<string>): PraiseDecision | null {
  for (const candidate of candidateDecisions(evidence)) {
    if (!isOnceEverPraise(candidate.kind) || !praisedKinds.has(candidate.kind)) return candidate;
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
  const decision = selectEvidence(input.evidence, input.praisedKinds);
  return decision ? { decision } : { suppressed: "no_evidence" };
}
