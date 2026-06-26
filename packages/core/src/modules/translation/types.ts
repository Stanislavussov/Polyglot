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
}

/**
 * Full AI translation result — multi-language.
 * Contains translations for all requested target languages in a single object.
 */
export interface TranslationResult {
  emoji: string;
  nativeMeaning?: string | null;
  sourceUsage?: SourceUsage | null;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
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
}

/** Output from translate() — enriched TranslationResult with metadata */
export interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  nativeMeaning?: string;
  sourceUsage?: SourceUsage;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
  dictionaryContext?: DictionaryContext;
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
  | "unsupported_input";

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
  /** Human-readable label for the button (e.g., "🇨🇿 Czech", "June 7", "bird (noun)") */
  label: string;
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
 * Structured ambiguity that requires user clarification before translation.
 *
 * Produced when the pipeline detects insufficient data to choose a single
 * translation confidently. The bot must show the ambiguity options to the
 * user and wait for their selection before proceeding.
 */
export interface TranslationAmbiguity {
  /** Categorized reason why clarification is needed */
  reason: TranslationAmbiguityReason;
  /** Human-readable explanation in the user's interface language */
  message: string;
  /** Concrete options the user can choose from (e.g., language variants, senses, date interpretations) */
  options?: TranslationAmbiguityOption[];
}

/** Severity of a quality issue found during validation or judging */
export type QualityIssueSeverity = "blocking" | "warning" | "info";

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
