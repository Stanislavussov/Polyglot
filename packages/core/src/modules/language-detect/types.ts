/** Input for resolveTranslationDirection() */
export interface ResolveDirectionInput {
  /** The text the user typed */
  text: string;
  /** User's native language (ISO 639-1) */
  nativeLang: string;
  /** User's learning languages (ISO 639-1) */
  learningLangs: string[];
}

/** Input for resolveDirectionFromSource() — explicit source language, no detection */
export interface ResolveFromSourceInput {
  /** Explicit source language (ISO 639-1) */
  sourceLang: string;
  /** User's native language (ISO 639-1) */
  nativeLang: string;
  /** User's learning languages (ISO 639-1) */
  learningLangs: string[];
}

/** Resolved translation direction based on detected input language */
export interface TranslationDirection {
  /** Source language for translation (ISO 639-1) */
  sourceLang: string;
  /** Target languages for translation (ISO 639-1) */
  targetLangs: string[];
  /** Detected input language (ISO 639-1), or undefined if inconclusive */
  detectedLang: string | undefined;
}

/**
 * A single piece of evidence from a detection strategy.
 *
 * Each strategy produces zero or more evidence entries — one per candidate
 * that the strategy found relevant. The `score` is a 0–1 confidence
 * contribution: higher means the strategy is more confident that the
 * text belongs to `candidate`.
 */
export interface DetectionEvidence {
  /** Strategy that produced this evidence (e.g. "script", "diacritics") */
  strategy: string;
  /** ISO 639-1 candidate language code */
  candidate: string;
  /** 0–1 confidence contribution from this strategy for this candidate */
  score: number;
  /** Human-readable explanation of why this strategy scored this candidate */
  reason: string;
}

/**
 * Result of confidence-aware language detection.
 *
 * When `language` is defined, the detector is confident enough to pick
 * a single candidate. When `language` is undefined, `ambiguousCandidates`
 * lists the candidates that scored above zero, sorted by score descending.
 * The bot should present these as clarification options to the user.
 */
export interface DetectionResult {
  /** Detected language, or undefined when ambiguous */
  language?: string;
  /** 0–1 confidence score for the detected language (0 when ambiguous) */
  confidence: number;
  /** All evidence entries collected from every strategy */
  evidence: DetectionEvidence[];
  /** Candidates with score > 0 when ambiguous, sorted by score descending */
  ambiguousCandidates?: string[];
  /**
   * Languages OUTSIDE the candidate set that dictionary or AI evidence points
   * to. Set only when no candidate explains the input — the caller should tell
   * the user the language isn't selected instead of mistranslating.
   */
  outOfSetLanguages?: string[];
}

/**
 * Dictionary sweep: ISO 639-1 codes of supported languages whose dictionary
 * contains the word, best coverage first. Injected by the adapter layer
 * (core stays DB-free), mirroring the ContextLookupFn pattern.
 */
export type FindWordLanguagesFn = (word: string) => Promise<string[]>;
