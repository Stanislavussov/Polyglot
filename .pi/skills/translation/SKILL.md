---
name: translation
description: Word and phrase translation via AI with prompt building, response parsing, and validation. Provides translate() and translateBatch() as the single entry points for all translation operations. Use when implementing or modifying translation logic, prompts, or response schemas.
---

# translation Agent Skill

## Module Location

`packages/core/src/modules/translation/` — core platform-independent translation module.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `ai` agent (for AI requests via injected `generateObjectFn`), `validation` agent (for response validation)
- **Dependents:** `topics` agent calls translateBatch(), `bot` agent calls translate()

## Current State

Fully implemented with types, Zod schemas, prompt builder, and a risk-based validation pipeline. Risk classification uses a points score and returns `low`, `medium`, or `high`: phrase/sentence input, risky register/topic hints, low detection confidence, uncommon language pairs, structural immutable features, multi-sense/idiom dictionary context, and deterministic validation failures route to `high`; ordinary unbacked words remain single-call `medium`; confident dictionary-backed minimal words stay `low`. Full retries are limited to generation/schema failures. Deterministic or judge failures use bounded targeted repair of the affected language block. High-risk requests run a structured semantic judge from a different model family. Sentence and technical-text validation preserves immutable spans and rejects generated placeholders, URLs, Markdown link targets, dates, and numbers that were not present in the source. Structural preflight ambiguity currently covers locale-ambiguous numeric dates and mixed scripts; generic lexical ambiguity awaits ranked sense IDs and confidence margins and must not be implemented with phrase-specific rules.

### Unified expression handling & 3 translation variants

- **Unified phrase/idiom POS**: `phrase` and `idiom` POS values are treated identically in the UI/rendering layer. The i18n key `expressionDetected` (with `{expression}` param) replaces the former `phraseDetected`/`idiomDetected` keys. Data can still have `pos: "phrase"` or `pos: "idiom"` — unification is purely in the presentation layer.
- **TranslationVariant & alternatives**: Each `LanguageTranslation` now has an optional `alternatives?: TranslationVariant[]` field (up to 2 additional translations beyond the main `text`). Each variant has its own `text` and `synonyms`. The AI prompt requests exactly 2 alternatives per language. The Zod schema (`translationVariantSchema`) validates variant entries.
- **Dictionary context multi-variant guidance**: When `dictionaryContext` has glosses, the prompt builder adds a hint to inform different translation variants — each alternative should capture a different sense or nuance if the word has multiple meanings.

### Task 27: Input type detection & sentence-aware translation

- **`InputType`**: New type `'word' | 'phrase' | 'sentence'` added to `types.ts`. Optional `inputType` field on both `TranslateInput` and `TranslationRequest`.
- **`SENTENCE_OUTPUT` preset**: New preset in `translation-output.presets.ts` — disables examples, synonyms, alternatives, equivalentNote; keeps only transcription. Used for sentence translations to save tokens and avoid irrelevant metadata.
- **Sentence-aware prompt builder**: When `inputType === 'sentence'`, the prompt uses `"Translate the following sentence from ... to ..."` intro (instead of `Translate "..."`). Topic hint says "sentence" instead of "word".
- **Sentence-aware validation**: `inputType` is passed through to `validate()` — when `'sentence'`, semantic validation (translation ≠ original) and alternatives/examples checks are skipped. Schema and language detection still run.
- **Backward compatible**: All changes are additive — `inputType` is optional, absent means full word/phrase behavior.

### Task 31: Redesign translation card — examples + connotation warnings

- **`Example` type**: `{ context, target, native? }`. `native` is optional for backward compatibility and contains the target example sentence translated into the user's native language when requested.
- **`LanguageTranslation.connotationWarning`**: Optional target-side note for noteworthy connotation, register, usage context, or risky/misleading target-language meaning.
- **`LanguageTranslation.usageNote`**: Required for normal word/phrase translation when a native language is configured. Contains regular target-specific nuance, register, and usage guidance in the user's native language; distinct from exceptional `connotationWarning`.
- **`TranslationOutputConfig.includeConnotationWarning`**: New optional boolean to control connotation warnings in AI prompt and schema.
- **`FULL_OUTPUT` preset**: `includeExamples` changed from `false` to `true`; `includeConnotationWarning: true` added. Interactive translations now show 3 example sentences per language.
- **Other presets**: `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT`, `SENTENCE_OUTPUT` all gained `includeConnotationWarning: false`.
- **Prompt builder**: Example instructions request native translations when `nativeLang` is provided. Connotation rules define `connotationWarning` as target-side metadata only; native-source input must not produce a source-word connotation explanation copied across target blocks. Top-level `nativeMeaning` is requested whenever `nativeLang` is available and is written in the user's configured native language.
- **Usage guidance**: Every non-sentence target block includes `usageNote` in the user's native language. `connotationWarning` remains optional and is omitted for neutral translations.
- **Schema**: `exampleSchema` accepts optional/nullish `native`. `languageTranslationSchema` and `buildLanguageTranslationSchema` include optional `connotationWarning`.
- **Validation**: Responses fail and retry when `nativeMeaning` is missing for native-language requests. Same-language target blocks must keep the original source expression, preventing source-language hallucinations such as Czech `kudlanka` being accepted as `klubko`.

### Translation quality program — TQ-01 and TQ-02

- Native example requirements are target-aware: target blocks matching `nativeLang` omit `example.native`; other target blocks still require it.
- The primary prompt forbids pronunciation, IPA, romanization, and transliteration in every field.
- Translation generation passes `frequencyPenalty: 0` through the injected AI function so examples can naturally repeat their assigned translation.
- Regression coverage includes `phase out` from English to Czech and Russian with Russian as the native language.
- The translation benchmark uses fixture schema version 1 and report schema version 4. It repeats stochastic translation and detection cases, records actual AI request tokens/cost/latency through the adapter metric sink, scores primary translation, auxiliary fields, factual preservation, naturalness/register, ambiguity handling, detection, and repair success separately, and emits Markdown plus JSON reports. The CLI supports three-or-more-model comparisons and same-model JSON baselines with statistically significant language-pair regression checks. Release gates also protect immutable content, ambiguity handling, 95% primary accuracy, 90% metadata accuracy, and the low-risk single-call path.

## Boundary

- **Mode:** role — when this skill is active, you ARE the translation agent. Only modify the translation module.
- **Produces:** translation source code and tests in `packages/core/src/modules/translation/`
- **Never:** modify code outside `packages/core/src/modules/translation/`
- **Never:** save results, access DB directly, or know about users
- **Never:** import AI adapter directly — AI generation function is injected
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/core/src/modules/translation/**`

## Rules

1. One method `translate()` — the single entry point
2. Does not save results — only returns them
3. Knows nothing about the user — works only with text and languages
4. Always calls the `validation` agent before returning a result
5. AI generation function is injected (no direct dependency on AI adapter from core)
6. Dictionary context is injected (no direct dependency on DB adapter from core)

## Types

```typescript
type ExpressionType = "literal" | "idiomatic_equivalent";

interface Synonym { text: string; }
interface Example { context: string; target: string; native?: string | null; }

/** A single alternative translation variant with its own synonyms */
interface TranslationVariant {
  text: string;
  synonyms: Synonym[];
}

interface DictionaryContext {
  word: string;            // headword without stress marks
  pos: string;             // "phrase", "noun", "verb", "adj", "idiom", etc.
  glosses: string[];       // English definitions from Wiktionary
  formTags?: string[];     // ["canonical", "romanization", "alternative"]
  langCode: string;        // ISO 639-1 language code
}

/**
 * Controls which fields are included in the AI translation response.
 * All fields default to true (full output) when absent.
 * Set a field to false to omit it from the AI prompt entirely.
 *
 * Rule: callers must always use a named preset — never construct
 * TranslationOutputConfig inline.
 */
interface TranslationOutputConfig {
  includeExamples?: boolean;       // Default: true — 3 example sentences
  includeTranscription?: boolean;  // Default: true — IPA transcription
  includeSynonyms?: boolean;       // Default: true — 2–3 synonyms
  includeAlternatives?: boolean;   // Default: true — 2 alternative variants
  includeEquivalentNote?: boolean; // Default: true — idiomatic expression info
  includeConnotationWarning?: boolean; // Default: true — optional target-side connotation notes
  includeNativeSynonyms?: boolean; // Default: true — source synonyms in native language
}

interface LanguageTranslation {
  text: string;
  transcription?: string | null;
  synonyms: Synonym[];
  examples: Example[];
  expressionType?: ExpressionType;   // defaults to 'literal'
  equivalentNote?: string | null;     // explanation for idiomatic equivalents
  alternatives?: TranslationVariant[] | null; // up to 2 alternative translations
  connotationWarning?: string | null; // optional target-side connotation/register/usage note
}

/** Detected input type — drives prompt, schema, and validation behavior */
type InputType = "word" | "phrase" | "sentence";

interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];   // array, 1–4 languages
  nativeLang?: string;
  topic?: string;
  dictionaryContext?: DictionaryContext;  // optional Wiktionary enrichment
  outputConfig?: TranslationOutputConfig; // optional output config
  inputType?: InputType;  // classified input type — drives prompt and validation
}

interface TranslationResult {
  emoji: string;
  nativeMeaning?: string;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
}

interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
  nativeLang?: string;
  model: string;
  topic?: string;
  userId?: number;
  dictionaryContext?: DictionaryContext;  // optional Wiktionary enrichment
  outputConfig?: TranslationOutputConfig; // optional output config
  inputType?: InputType;  // classified input type — drives prompt and validation
}

interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  nativeMeaning?: string;
  sourceUsage?: SourceUsage;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
  dictionaryContext?: DictionaryContext;
}

// ── Translation decision contract (Step 2) ──

type TranslationAmbiguityReason =
  | "source_language" | "word_sense" | "date_or_time"
  | "placeholder_grammar" | "mixed_or_transliterated_input";

interface TranslationAmbiguityOption { label: string; value: string; }

interface TranslationAmbiguity {
  reason: TranslationAmbiguityReason;
  message: string;
  options?: TranslationAmbiguityOption[];
}

type QualityIssueSeverity = "blocking" | "warning" | "info";

interface QualityIssue {
  fieldPath: string;
  severity: QualityIssueSeverity;
  message: string;
  repairInstruction?: string;
}

type RiskLevel = "low" | "medium" | "high";

interface QualityMetadata {
  promptVersion: string;
  schemaVersion: number;
  riskLevel: RiskLevel;
  modelId: string;
  attemptCount: number;
  judgeResult?: unknown;
  issues: QualityIssue[];
}

type TranslationDecision =
  | { status: "accepted"; output: TranslateOutput; quality: QualityMetadata }
  | { status: "needs_clarification"; ambiguity: TranslationAmbiguity }
  | { status: "needs_review"; output: TranslateOutput; issues: QualityIssue[] };

type GenerateObjectFn = <T>(prompt: string, schema: ZodSchema<T>, model: string, options?: { userId?: number }) => Promise<T>;
```

## Skills (Public API)

```typescript
async function translate(input: TranslateInput, generateObjectFn: GenerateObjectFn): Promise<TranslationDecision>;

// Single-language translation for partial regeneration
async function translateOne(
  input: TranslateInput & { targetLang: string },
  generateObjectFn: GenerateObjectFn
): Promise<TranslationDecision>;

// Batch translation for topics (sequential, not parallel)
async function translateBatch(
  words: string[], sourceLang: string, targetLangs: string[],
  model: string, generateObjectFn: GenerateObjectFn
): Promise<TranslationDecision[]>;

// Build the AI prompt from a request (config-aware: omits sections for disabled fields)
function buildTranslationPrompt(request: TranslationRequest): string;

// Build strict retry prompt with error feedback (config-aware)
function buildStrictPrompt(request: TranslationRequest, errors: string[]): string;

// Build per-language schema, relaxing disabled fields
function buildLanguageTranslationSchema(config?: TranslationOutputConfig): ZodSchema;

// Build result schema with required language keys (config relaxes disabled fields)
function buildTranslationResultSchema(
  targetLangs: string[],
  config?: TranslationOutputConfig,
  requireNative?: boolean,
  requireSourceUsage?: boolean,
  nativeLang?: string,
): ZodSchema;

// Parse and validate raw AI response
function parseResponse(raw: unknown): TranslationResult;
```

## Output Presets (Task 21)

Centralized named presets in `translation-output.presets.ts` — single source of truth. Callers must always import a preset, never construct `TranslationOutputConfig` inline.

```typescript
import { FULL_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT, RELIABLE_OUTPUT, SENTENCE_OUTPUT } from "@polyglot/core";
```

| Preset | Examples | Transcription | Synonyms | Alternatives | EquivalentNote | Register | ConnotationWarning |
|---|---|---|---|---|---|---|---|
| `FULL_OUTPUT` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `RELIABLE_OUTPUT` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `MINIMAL_OUTPUT` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `NOTIFICATION_OUTPUT` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `SENTENCE_OUTPUT` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Caller → Preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (bot interactive, no custom template) | `RELIABLE_OUTPUT` via `DEFAULT_TEMPLATE` | Cheap-model reliable default |
| `translate-mode.helper.ts` (bot interactive, custom template) | Template-derived config | User-requested detail |
| `regen.helper.ts` (regeneration, no custom template) | `RELIABLE_OUTPUT` via `DEFAULT_TEMPLATE` | Same reliable contract as initial translation |
| `regen.helper.ts` (regeneration, custom template) | Template-derived config | Same detail as user's template |
| `translate-mode.helper.ts` (sentence) | `SENTENCE_OUTPUT` | Minimal output for sentences — no learning metadata |
| `regen.helper.ts` (sentence regen) | `SENTENCE_OUTPUT` | Sentence regen uses same minimal preset |
| `topic.service.ts` (bulk topic translation) | `MINIMAL_OUTPUT` | Token savings for batch jobs |
| Notification word-of-the-day (future) | `NOTIFICATION_OUTPUT` | Compact push with examples |

## Translation Flow

```
0. Analyze input and return needs_clarification for supported structural ambiguity
1. Generate structured translation output
2. Retry the full request only for generation or schema failure
3. Run deterministic validation, including sentence semantic and immutable checks
4. Target-repair failing language blocks
5. Compute risk; judge high-risk results with a different model family
6. Target-repair blocking judge issues and re-judge
7. Return accepted or needs_review with field-level issues
```

## Dictionary Context Enrichment (Task 13)

When `dictionaryContext` is provided in `TranslateInput`:
- The prompt builder adds a "Dictionary Context (from Wiktionary):" section
- Includes POS, glosses (max 5), and form tags
- For `pos=phrase` or `pos=idiom`, adds a "fixed expression" translation hint
- The context is preserved through validation retries and echoed in `TranslateOutput`
- Callers (e.g., bot layer) are responsible for DB lookup and injection

## Zod Schemas

- `translationRequestSchema` — validates TranslationRequest (targetLangs 1–4)
- `translationResultSchema` — validates full AI response (emoji, nativeSynonyms, translations map)
- `buildTranslationResultSchema(targetLangs, config?, requireNative?, requireSourceUsage?, nativeLang?)` — builds dynamic schema with required language keys, omits disabled fields, and requires native example translations only for target languages different from `nativeLang`
- `buildLanguageTranslationSchema(config?)` — builds per-language schema, omitting disabled fields
- `languageTranslationSchema` — validates per-language translation entry (includes optional `expressionType` defaulting to `'literal'`, optional `equivalentNote`, optional `alternatives`)
- `translationVariantSchema` — validates alternative translation variant { text, synonyms }
- `synonymSchema` — validates synonym { text }
- `exampleSchema` — validates example { context, target, native? }

## File Structure

```
packages/core/src/modules/translation/
├── index.ts                           # Re-exports: translate, translateOne, translateBatch, schemas, types, ExpressionType, InputType, DictionaryContext, TranslationVariant, TranslationOutputConfig, presets (incl. SENTENCE_OUTPUT)
├── quality.schema.ts                  # Structured semantic-judge issues and summary
├── types.ts                           # TranslateInput, TranslateOutput, TranslationOutputConfig, InputType, ExpressionType, DictionaryContext, etc.
├── translation.service.ts             # translate(), translateOne(), translateBatch(), parseResponse() — passes inputType to validate()
├── translation-output.presets.ts      # FULL_OUTPUT, RELIABLE_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT, SENTENCE_OUTPUT presets
├── prompt.builder.ts                  # buildTranslationPrompt(), buildStrictPrompt(), buildDictionaryHint() — config-aware, sentence-aware
├── schemas/
│   └── translation.schema.ts          # Zod schemas for AI response, buildLanguageTranslationSchema(config?)
└── __tests__/
    ├── translation.schema.test.ts     # 36 tests (incl. new example shape + connotationWarning)
    ├── prompt.builder.test.ts         # prompt tests incl. alternatives + variant guidance + sentence-aware prompt + connotation warning
    ├── translation.service.test.ts    # 27 tests (incl. translateOne + validation logging + alternatives + dictionary context passthrough)
    ├── idiomatic-equivalents.test.ts  # 18 tests (schema + prompt idiomatic features)
    ├── dictionary-context.test.ts     # 30 tests (prompt enrichment + passthrough + edge cases + multi-variant guidance)
    └── output-config.test.ts          # 35 tests (presets incl. SENTENCE_OUTPUT + connotationWarning, config-aware prompt/schema builder, sentence service integration)
```

## Reference

- AI prompt structure: `docs/tech-reqs/08-ai-prompt.md`
- AI validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (translation section)
- BRD § 6.1 (Word/Phrase Translation), § 10 (AI Response Schema)
- Task 13 Wiktionary: `docs/tasks/13-wiktionary-jsonl.md`
- Task 16 Auto-detect: `docs/tasks/16-auto-detect-input-language.md`
- Language detection skill: `.pi/skills/validation/SKILL.md` (detectLanguage, resolveTranslationDirection)
