import { isSupportedLanguage } from "../i18n/language-registry.js";
import { detectOutOfSetByAlphabet, detectOutOfSetLanguage } from "../language-detect/detect-language.js";
import { resolveDirectionFromSource, resolveTranslationDirection } from "../language-detect/resolve-direction.js";
import type { DetectionResult } from "../language-detect/types.js";
import type { TranslationAmbiguity } from "../translation/types.js";

/**
 * Task 70 cross-language guard. A `needs_clarification` of reason
 * `unrecognized_word` carries the AI's spelling correction; when that correction
 * is written in the exclusive alphabet of a SUPPORTED language the user does not
 * study, the "unrecognized word" is really an out-of-set language the closed-set
 * detector coerced to a studied one — e.g. Russian-lettered Kazakh "кыздарай",
 * corrected to "қыздар-ай" whose "қ" exists only in Kazakh. Returns that
 * language so the flow can offer "add and translate" instead of a nonsensical
 * spelling fix. Returns undefined for genuine same-alphabet typos (Slovak vs
 * Czech share their alphabet and cannot be told apart by letters alone — those
 * need a dictionary/AI signal the alphabet check deliberately does not fake).
 */
export function outOfSetLanguageFromCorrection(
  ambiguity: TranslationAmbiguity,
  nativeLang: string,
  learningLangs: readonly string[],
): string | undefined {
  // Both correction-bearing reasons: the metadata existence guard answers
  // "unrecognized_word", the spelling preflight "possible_typo", and either can
  // be the coerced out-of-set language rather than a typo.
  if (ambiguity.reason !== "unrecognized_word" && ambiguity.reason !== "possible_typo") {
    return undefined;
  }
  const correction = (ambiguity.options ?? []).find((option) => option.kind === "typo_correction")?.correctedText;
  if (!correction) {
    return undefined;
  }
  const outOfSetLang = detectOutOfSetByAlphabet(correction, [nativeLang, ...learningLangs]);
  return outOfSetLang && isSupportedLanguage(outOfSetLang) ? outOfSetLang : undefined;
}

/** Shared script alone is too weak to interrupt the user; dictionary hits in two languages are not. */
export function hasActionableLanguageAmbiguity(detection: DetectionResult): boolean {
  const candidates = detection.ambiguousCandidates ?? [];
  if (candidates.length < 2) {
    return false;
  }

  const wiktionaryCandidates = new Set(
    detection.evidence.filter((entry) => entry.strategy === "wiktionary").map((entry) => entry.candidate),
  );
  return candidates.filter((candidate) => wiktionaryCandidates.has(candidate)).length >= 2;
}

/**
 * The language the input is in although the user does not study it, before any AI call.
 *
 * The franc pass runs an UNCONSTRAINED francAll that readily prefers a close
 * sibling of an in-set language (Czech → Croatian, Russian → Bulgarian), so it
 * must not override a confident closed-set detection; the dictionary/AI and
 * alphabet-exclusion signals are conservative enough to stay unconditional.
 */
export function detectOutOfSetSource(
  text: string,
  detection: DetectionResult,
  candidates: string[],
): string | undefined {
  return (
    detection.outOfSetLanguages?.[0] ??
    detectOutOfSetByAlphabet(text, candidates) ??
    (detection.language === undefined ? detectOutOfSetLanguage(text, candidates) : undefined)
  );
}

export type DirectionDecision =
  | {
      kind: "resolved";
      sourceLang: string;
      targetLangs: string[];
      detectedLang: string | undefined;
      /** The source is a heuristic guess, so a channel may offer a "translate from" override. */
      doubtful: boolean;
    }
  | { kind: "ambiguous"; candidates: string[]; fallback: { sourceLang: string; targetLangs: string[] } }
  | { kind: "inconclusive"; fallback: { sourceLang: string; targetLangs: string[] } };

/** The bot's direction rules: a detected studied language, English, a guess, or a question. */
export function decideDirection(
  text: string,
  detection: DetectionResult,
  nativeLang: string,
  learningLangs: string[],
): DirectionDecision {
  const guess = () => resolveTranslationDirection({ text, nativeLang, learningLangs });
  if (detection.language !== undefined) {
    const direction = resolveDirectionFromSource({ sourceLang: detection.language, nativeLang, learningLangs });
    if (direction) {
      return { kind: "resolved", ...direction, detectedLang: detection.language, doubtful: false };
    }
    if (detection.language === "en") {
      // English is accepted as a source even when the user does not study it; the
      // targets still lead with the native language, as for a learning-language source.
      return {
        kind: "resolved",
        sourceLang: "en",
        targetLangs: [nativeLang, ...learningLangs.filter((code) => code !== "en")],
        detectedLang: "en",
        doubtful: false,
      };
    }
    const fallback = guess();
    return { kind: "resolved", ...fallback, doubtful: true };
  }
  if (hasActionableLanguageAmbiguity(detection)) {
    const fallback = guess();
    return {
      kind: "ambiguous",
      candidates: detection.ambiguousCandidates ?? [],
      fallback: { sourceLang: fallback.sourceLang, targetLangs: fallback.targetLangs },
    };
  }
  if (detection.ambiguousCandidates && detection.ambiguousCandidates.length > 0) {
    const fallback = guess();
    return { kind: "resolved", ...fallback, doubtful: true };
  }
  const fallback = guess();
  return { kind: "inconclusive", fallback: { sourceLang: fallback.sourceLang, targetLangs: fallback.targetLangs } };
}
