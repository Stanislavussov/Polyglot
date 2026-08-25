/**
 * Translation module types.
 *
 * Matches BRD § 10 AI Response Schema: multi-language translation
 * with emoji, register, synonyms, and contextual examples.
 */

/** Whether a translation is literal or an idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/**
 * Dictionary context from Wiktionary — offline enrichment data.
 *
 * Passed into the translation pipeline by the caller (e.g., bot layer)
 * after looking up word_context from the database.
 * Core never calls the DB directly — this is injected.
 */
export interface DictionaryContext {
  /** Headword without stress marks */
  word: string;
  /** Part of speech: "phrase", "noun", "verb", "adj", "idiom", etc. */
  pos: string;
  /** English definitions/translations from Wiktionary */
  glosses: string[];
  /** Tags for canonical form: "canonical", "romanization", "alternative" */
  formTags?: string[];
  /** ISO 639-1 language code: "ru", "en", "de" */
  langCode: string;
}

/** A synonym */
export interface Synonym {
  text: string;
}

/** An example sentence with context, target language, and optional native translation */
export interface Example {
  context: string;
  target: string;
  native?: string | null;
}

/** Learning-language usage help for reverse translations */
export interface SourceUsage {
  /**
   * Canonical citation form of the source headword in the source language
   * (e.g. German "die Arbeit" for the input "arbeit"). Display-only — the card
   * renders it in place of the raw input; absent when nothing needs normalizing.
   */
  headword?: string | null;
  /** Native-language explanation of meaning, nuance, and when to use the source word */
  explanation: string;
  /** Close synonyms in the source learning language */
  synonyms: Synonym[];
  /** Source-language examples with native-language translations when available */
  examples: Example[];
}

/** A single translation variant */
export interface TranslationVariant {
  text: string;
  synonyms: Synonym[];
}

/** Translation data for a single target language */
export interface LanguageTranslation {
  text: string;
  synonyms: Synonym[];
  examples: Example[];
  /** Signals whether the translation is literal or an idiomatic equivalent */
  expressionType?: ExpressionType | null;
  /** Short note in the source language explaining why an equivalent was chosen */
  equivalentNote?: string | null;
  /** Regular native-language guidance about nuance, register, and natural usage */
  usageNote?: string | null;
  /** Up to 2 alternative translation variants */
  alternatives?: TranslationVariant[] | null;
  /** Optional target-side note about noteworthy connotation, register, or usage risk */
  connotationWarning?: string | null;
  /** Constructional grammar breakdown — high-level patterns, not token-by-token */
  grammarBreakdown?: string[] | null;
}

// TranslationOutputConfig lives in shared/ so leaf modules (topics, etc.)
// can use it without creating forbidden cross-module imports.
import type { TranslationOutputConfig } from "../../shared/types.js";

export type { TranslationOutputConfig } from "../../shared/types.js";

// InputType is owned by the input-analysis module (Step 3 — moved from translation
// to the dedicated leaf module). Re-exported here for backward compatibility.
import type { InputType } from "../input-analysis/types.js";

export type { InputType };

/** Risk level of a translation request — drives validation and judge routing */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Optional model routing policy derived from benchmark results.
 *
 * `model` remains the default generation model. Supplying overrides lets callers
 * route risky requests to a stronger model while preserving cheap single-call
 * behavior for low-risk translations.
 */
export interface TranslationModelRoutingPolicy {
  /** Generation model for low-risk requests */
  lowRiskModel?: string;
  /** Generation model for medium-risk requests */
  mediumRiskModel?: string;
  /** Generation model for high-risk requests and high-risk repairs */
  highRiskModel?: string;
  /** Semantic judge model. Prefer a different provider family than the generator. */
  judgeModel?: string;
}

/** Input for a translation request */
export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];
  /** User's native language — for native synonym generation */
  nativeLang?: string;
  topic?: string;
  /** Optional Wiktionary dictionary context for prompt enrichment */
  dictionaryContext?: DictionaryContext;
  /** Optional output config to control which fields are requested from AI */
  outputConfig?: TranslationOutputConfig;
  /** Classified input type — drives prompt, schema, and validation behavior */
  inputType?: InputType;
  /** Previous translations to avoid — for "other meaning" regeneration */
  negativeConstraints?: Record<string, string[]>;
  /**
   * The single sense every language block must render, resolved by the metadata
   * call before the per-language fan-out. Without it each language call picks a
   * sense independently, so a polysemous word ("wasted" = drunk / squandered)
   * yields a card whose blocks disagree. Absent for sentences and when the
   * metadata call did not run.
   */
  senseAnchor?: string;
}

/**
 * Full AI translation result — multi-language.
 * Contains translations for all requested target languages in a single object.
 */
export interface TranslationResult {
  /** Card-header emoji. Optional: sentence output omits it (includeEmoji: false). */
  emoji?: string;
  nativeMeaning?: string | null;
  sourceUsage?: SourceUsage | null;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
}

/**
 * Policy governing input correction and source-word verification (Fable T23).
 *
 * Groups the formerly-flat task flags (`skipInputCorrection`,
 * `assessSourceExistence`) so new correction/verification toggles are added here
 * (OCP) instead of widening `TranslateInput`. An absent policy behaves exactly
 * as before all flags were absent.
 */
export interface TranslationCorrectionPolicy {
  /**
   * Suppress AI input-correction (Task 69). When true, the preflight never
   * auto-corrects (`proceed_with_correction`) nor asks about typos
   * (`confirm_typo_suggestion`) — the input is translated verbatim. Set on
   * "translate as written" re-runs and after the language/mistype confirmation
   * flow so the user is not re-asked about the same word.
   */
  skipInputCorrection?: boolean;
  /**
   * Opt into the source-word existence assessment (Task 70). When true and the
   * input is a word/phrase, the main translation call also judges whether the
   * source headword is a real, correctly-spelled word/expression in the source
   * language. An unrecognized headword yields a `needs_clarification`
   * ("unrecognized_word") outcome unless `skipInputCorrection` is set (the user
   * already chose to translate as written), in which case the card is produced
   * but flagged `unverified` with a visible caveat. Off by default so batch,
   * topic, and video-vocabulary flows are unaffected.
   */
  assessSourceExistence?: boolean;
}

/** Input for the translate() entry point */
export interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
  /** User's native language — for native synonym generation */
  nativeLang?: string;
  model: string;
  topic?: string;
  userId?: number;
  /** Optional Wiktionary dictionary context for translation enrichment */
  dictionaryContext?: DictionaryContext;
  /** Optional output config to control which fields are requested from AI */
  outputConfig?: TranslationOutputConfig;
  /** Classified input type — drives prompt, schema, and validation behavior */
  inputType?: InputType;
  /** Confidence from upstream source-language detection when available */
  detectionConfidence?: number;
  /** User interface language for preflight explanations and option labels */
  interfaceLang?: string;
  /** Optional benchmark-derived routing policy for generation and judge models */
  modelRouting?: TranslationModelRoutingPolicy;
  /** Previous translations to avoid — for "other meaning" regeneration */
  negativeConstraints?: Record<string, string[]>;
  /**
   * Correction / source-verification policy (Fable T23). Groups the dictionary
   * hit signal and the input-correction / existence-assessment toggles.
   */
  correctionPolicy?: TranslationCorrectionPolicy;
  /**
   * ABSOLUTE wall-clock deadline (ms on the {@link now} time base, i.e. an
   * epoch timestamp by default) for this translate() call.
   *
   * Deliberately a deadline rather than a duration: the caller stamps it once at
   * the TRUE start of the operation it is guarding, so anything it does before
   * reaching `translate()` (a dictionary-context lookup, quota checks) is spent
   * out of the same window. A duration would let core re-anchor its clock on
   * arrival and silently push the effective deadline past the caller's own hard
   * timeout — turning graceful degradation into a user-facing error.
   *
   * When supplied, the post-generation tail bounds itself against the remaining
   * time: the whole-batch retry stops starting new rounds once only the reserved
   * judge window is left, each targeted repair round runs under a time box that
   * cannot consume that reservation, and the semantic judge runs under a time
   * box (falling back to the already-validated pre-judge result, flagged
   * `needs_review` because no semantic gate was obtained).
   *
   * ABSENT — or `NaN`/`Infinity`/`0`/negative — means **unbounded**: every phase
   * behaves exactly as it did before budgets existed, with no timer created at
   * all. Core never invents a deadline of its own.
   */
  deadlineAt?: number;
  /**
   * Injected clock (ms) backing {@link deadlineAt} and the phase timings reported
   * to {@link TranslationHooks.onPhase}. Defaults to `Date.now`. A TEST SEAM
   * only — production callers pass just the deadline — so budget arithmetic is
   * deterministic under test without fake timers.
   */
  now?: () => number;
}

/**
 * Internal pipeline phases a caller can observe.
 *
 * `generate` and the post-generation phases `validate` (deterministic
 * validation + targeted repair) and `judge` (semantic judge + repair-and-re-judge)
 * live entirely inside core, so without this seam they are unmeasurable from the
 * outside.
 */
export type TranslationPhase = "preflight" | "generate" | "validate" | "judge";

/**
 * Sink for internal phase timings. Deliberately a plain callback: core reports
 * numbers and knows nothing about metrics, Prometheus, or the channel. A
 * throwing observer never affects the translation.
 */
export type TranslationPhaseObserver = (phase: TranslationPhase, elapsedMs: number) => void;

/**
 * Optional observation hooks for a translate() call. Every field is optional and
 * a no-op when absent; hooks may only observe, never influence, the pipeline.
 */
export interface TranslationHooks {
  /** Invoked as each internal phase completes, with its wall-clock duration. */
  onPhase?: TranslationPhaseObserver;
}

/**
 * A silently-applied input correction (Task 69 — `proceed_with_correction`).
 *
 * Produced by the AI preflight when the user's input contains a minor,
 * unambiguous typo. The pipeline translates the `corrected` text but keeps a
 * record of what was fixed so the bot can annotate the reply
 * ("✏️ Fixed: original → corrected — explanation").
 */
export interface InputCorrection {
  /** The text the user actually typed */
  original: string;
  /** The corrected text that was translated */
  corrected: string;
  /** Short native-language explanation of the fix */
  explanation: string;
}

/** Output from translate() — enriched TranslationResult with metadata */
export interface TranslateOutput {
  original: string;
  sourceLang: string;
  /** Card-header emoji. Optional: sentence output omits it (includeEmoji: false). */
  emoji?: string;
  nativeMeaning?: string;
  sourceUsage?: SourceUsage;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
  dictionaryContext?: DictionaryContext;
  /**
   * Set when the input was silently corrected before translation.
   * `original` is the user's verbatim text; `original`/`corrected`/`explanation`
   * drive the "✏️ Fixed" annotation. `TranslateOutput.original` already holds
   * the corrected form (that is what was translated and what gets saved).
   */
  correction?: InputCorrection;
  /**
   * True when the source headword was assessed as not a recognized word in the
   * source language but translated anyway on the user's "translate as written"
   * override (Task 70). The card renders a caveat line and, when saved, the
   * entry is flagged `unverified` and excluded from notifications/SRS picks.
   */
  unverified?: boolean;
}

// ─────────────────────────────────────────────
// Translation decision contract (Step 2 — quality improvement plan)
// ─────────────────────────────────────────────

/**
 * Reasons why a translation needs user clarification before proceeding.
 *
 * Each reason maps to a specific kind of ambiguity that the pipeline
 * cannot resolve silently without risking an incorrect translation.
 */
export type TranslationAmbiguityReason =
  | "source_language"
  | "word_sense"
  | "possible_typo"
  | "date_or_time"
  | "placeholder_grammar"
  | "mixed_or_transliterated_input"
  | "unsupported_input"
  // The main translation call assessed the source headword as not a real,
  // correctly-spelled word/expression in the source language (Task 70). The
  // user is offered any confident correction plus "translate as written".
  | "unrecognized_word";

export type TranslationAmbiguityOptionKind =
  | "source_language"
  | "meaning"
  | "typo_correction"
  | "format"
  | "translate_as_written";

/**
 * A concrete option the user can choose when clarifying an ambiguity.
 *
 * The bot presents these options as buttons; the user selects one
 * before the translation proceeds.
 */
export interface TranslationAmbiguityOption {
  /** Stable option id for UI callbacks */
  id?: string;
  /**
   * Human-readable label for the button (e.g., "🇨🇿 Czech", "June 7", "bird
   * (noun)"). Optional: core omits it for options whose label the channel
   * derives from `kind` (e.g. `translate_as_written`), so core never localizes
   * UI strings (Fable T23/A13). When absent the channel supplies the label.
   */
  label?: string;
  /** Machine-readable value that the caller feeds back into the pipeline */
  value: string;
  /** Option kind for caller-specific follow-up behavior */
  kind?: TranslationAmbiguityOptionKind;
  /** Source language selected by this option, when kind is source_language */
  langCode?: string;
  /** Corrected text selected by this option, when kind is typo_correction */
  correctedText?: string;
}

/**
 * Structured interpolation params for channel-side localization (Fable T23/A13).
 *
 * Core returns these instead of a pre-localized message so each channel can
 * render the reason via its own `t()` (e.g. the unrecognized-word reason needs
 * the offending `word` and the source-language `lang` CODE — the channel
 * localizes the display name from the code).
 */
export interface TranslationAmbiguityParams {
  /** The user's input word/text relevant to the clarification. */
  word?: string;
  /** Source language CODE (the channel localizes the display name). */
  lang?: string;
}

/**
 * Structured ambiguity that requires user clarification before translation.
 *
 * Produced when the pipeline detects insufficient data to choose a single
 * translation confidently. The bot must show the ambiguity options to the
 * user and wait for their selection before proceeding.
 */
export interface TranslationAmbiguity {
  /** Categorized reason why clarification is needed */
  reason: TranslationAmbiguityReason;
  /**
   * Optional human-readable explanation. Present only when it originates from
   * the AI preflight (model output already in the user's language) or as a
   * structural hint; ABSENT for fully-structured reasons the channel localizes
   * from `reason` + `params`. Core never returns i18n-`t()` strings here
   * (Fable T23/A13) — localization is the channel's responsibility.
   */
  message?: string;
  /** Structured interpolation params for channel-side localization. */
  params?: TranslationAmbiguityParams;
  /** Concrete options the user can choose from (e.g., language variants, senses, date interpretations) */
  options?: TranslationAmbiguityOption[];
}

/**
 * Severity of a quality issue found during validation or judging.
 *
 * - `blocking` — must be fixed before acceptance; forces needs_review, triggers
 *   targeted repair, and suppresses the high-risk semantic judge.
 * - `warning` / `info` — recorded but never blocking.
 * - `advisory` — a non-blocking severity for self-documenting, low-confidence
 *   deterministic rules (currently only the single-word first-example check).
 *   It never forces needs_review, never triggers repair, and — the point of the
 *   distinction — does NOT suppress the semantic judge, so a high-risk word with
 *   only an advisory issue still gets its real semantic gate.
 */
export type QualityIssueSeverity = "blocking" | "warning" | "advisory" | "info";

/**
 * A single quality issue with location, severity, and optional repair guidance.
 *
 * Used in both `needs_review` decisions and `QualityMetadata.issues` on
 * accepted results (where issues are typically warnings or info-level).
 */
export interface QualityIssue {
  /** Dotted field path, e.g., "translations.cs.text", "nativeMeaning" */
  fieldPath: string;
  /** How severe the issue is — blocking issues must be fixed before acceptance */
  severity: QualityIssueSeverity;
  /** Human-readable description of the problem */
  message: string;
  /** Optional instruction for targeted repair (used in Step 8) */
  repairInstruction?: string;
}

/**
 * Quality metadata attached to accepted translation decisions.
 *
 * Tracks the prompt and schema versions used, the risk level, model,
 * attempt count, and any quality issues found. The `judgeResult` field
 * is populated when high-risk routing invokes the cross-model semantic judge.
 */
export interface QualityMetadata {
  /** Prompt template version (e.g., "translation-v1") */
  promptVersion: string;
  /** Translation Zod schema version */
  schemaVersion: number;
  /** Risk classification — drives judge routing (Step 7) */
  riskLevel: RiskLevel;
  /** AI model ID used for generation */
  modelId: string;
  /** Total generation attempts (1 = first attempt succeeded, 3 = exhausted retries) */
  attemptCount: number;
  /** Result from the cross-model semantic judge when risk routing invokes it */
  judgeResult?: unknown;
  /** Quality issues found during validation (empty array when all checks pass) */
  issues: QualityIssue[];
  /** Source-language detection confidence (0–1) from detectLanguageWithConfidence */
  detectionConfidence?: number;
}

/**
 * Orchestrated translation result — the contract between the translation
 * pipeline and its callers.
 *
 * Replaces the former implicit `TranslateOutput` with `needsReview: boolean`.
 * Callers must check `decision.status` before accessing `decision.output`:
 *
 * - `accepted` — translation passed all validations; `output` is ready to render.
 * - `needs_clarification` — the pipeline detected an ambiguity that requires
 *   user input before translation can proceed; `output` is absent.
 * - `needs_review` — translation was produced but failed validation after
 *   all retries; `output` is available but may contain errors; `issues`
 *   describes what went wrong.
 *
 * Structural ambiguity such as mixed scripts or locale-dependent numeric dates
 * can produce `needs_clarification` before generation.
 */
export type TranslationDecision =
  | { status: "accepted"; output: TranslateOutput; quality: QualityMetadata }
  | { status: "needs_clarification"; ambiguity: TranslationAmbiguity }
  | { status: "needs_review"; output: TranslateOutput; issues: QualityIssue[] };
