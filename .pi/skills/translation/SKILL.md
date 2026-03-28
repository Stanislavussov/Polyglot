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

Fully implemented with types, Zod schemas, prompt builder, and translation service with validation pipeline. Structured logging added: `console.warn` on each failed validation attempt and `console.error` after all retries exhausted (core stays infra-free per architecture constraints). Task 07 partial regeneration: added `translateOne()` — a thin wrapper around `translate()` that translates a single target language and returns just the `LanguageTranslation`, used by the bot's per-language regeneration flow. Task 09 translate session loop: no translation module changes needed — persistent translate mode is a bot-layer routing concern; the bot's mode router calls `translate()` for each plain text message while in translate mode; i18n keys (`translateModeOn`, `translateModeHint`) were added to support mode confirmation/hint messages. Task 10 idiomatic equivalents: added `ExpressionType` type (`'literal' | 'idiomatic_equivalent'`), `expressionType` and `equivalentNote` optional fields to `LanguageTranslation` and the Zod schema, added Idiomatic & Proverb Rule block to prompt builder, and `ExpressionType` is re-exported from the module index. Task 13 Wiktionary integration: added `DictionaryContext` type for offline dictionary enrichment, optional `dictionaryContext` field on `TranslateInput`/`TranslateOutput`/`TranslationRequest`, prompt builder enrichment with Wiktionary glosses/POS/form tags, phrase/idiom detection hints, and `translateOne()` passthrough. Context is injected by caller (e.g., bot layer) — core never calls DB directly. Task 15 context-enrichment layer: `dictionaryContext` is now managed by the context-enrichment module (`translateWithContext`, `translateOneWithContext`, `translateBatchWithContext`). Callers should use the enrichment layer instead of manually looking up and injecting `dictionaryContext`. See `.pi/skills/context-enrichment/SKILL.md`. Task 16 auto-detect input language: no translation module changes needed — `translate()`, `translateOne()`, and `translateBatch()` already accept arbitrary `sourceLang`/`targetLangs` parameters. Language detection and direction resolution live in the sibling `language-detect` module (`detectLanguage()`, `resolveTranslationDirection()`), which the bot layer calls before invoking translation. The translation pipeline remains direction-agnostic — it translates whatever `sourceLang → targetLangs` it receives. Task 17 post-translation source language selection menu: no translation module changes needed — the feature is a bot-layer UI concern (session state, inline keyboards, callbacks). The translation pipeline continues to accept whatever `sourceLang → targetLangs` it receives. i18n keys (`nextTranslationFrom`, `nextSourceSet`) were added to support the source language menu UI. The sibling `language-detect` module gained `resolveDirectionFromSource()` for explicit source language direction resolution (no auto-detection), used by the bot layer when a user has manually selected a source language. Task 21: Added `TranslationOutputConfig` with centralized presets (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT`). Prompt builder and schema builder are config-aware — disabled fields are omitted from the AI prompt and relaxed in the Zod schema. All callers reference a preset — output is managed in one place (`translation-output.presets.ts`), not in user settings.

### Unified expression handling & 3 translation variants

- **Unified phrase/idiom POS**: `phrase` and `idiom` POS values are treated identically in the UI/rendering layer. The i18n key `expressionDetected` (with `{expression}` param) replaces the former `phraseDetected`/`idiomDetected` keys. Data can still have `pos: "phrase"` or `pos: "idiom"` — unification is purely in the presentation layer.
- **TranslationVariant & alternatives**: Each `LanguageTranslation` now has an optional `alternatives?: TranslationVariant[]` field (up to 2 additional translations beyond the main `text`). Each variant has its own `text`, `register`, and `synonyms`. The AI prompt requests exactly 2 alternatives per language. The Zod schema (`translationVariantSchema`) validates variant entries.
- **Dictionary context multi-variant guidance**: When `dictionaryContext` has glosses, the prompt builder adds a hint to inform different translation variants — each alternative should capture a different sense or nuance if the word has multiple meanings.

### Task 27: Input type detection & sentence-aware translation

- **`InputType`**: New type `'word' | 'phrase' | 'sentence'` added to `types.ts`. Optional `inputType` field on both `TranslateInput` and `TranslationRequest`.
- **`SENTENCE_OUTPUT` preset**: New preset in `translation-output.presets.ts` — disables examples, synonyms, alternatives, equivalentNote; keeps only transcription. Used for sentence translations to save tokens and avoid irrelevant metadata.
- **Sentence-aware prompt builder**: When `inputType === 'sentence'`, the prompt uses `"Translate the following sentence from ... to ..."` intro (instead of `Translate "..."`) and CEFR rule says "overall difficulty of the sentence" (not "translated word"). Topic hint says "sentence" instead of "word".
- **Sentence-aware validation**: `inputType` is passed through to `validate()` — when `'sentence'`, semantic validation (translation ≠ original) and alternatives/examples checks are skipped. Schema and language detection still run.
- **Backward compatible**: All changes are additive — `inputType` is optional, absent means full word/phrase behavior.

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
type Register = "slang" | "colloquial" | "neutral" | "literary" | "professional";
type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type ExampleContext = "formal" | "colloquial" | "professional";

interface Synonym { text: string; register: Register; }
interface Example { context: ExampleContext; target: string; native: string; }

/** A single alternative translation variant with its own register and synonyms */
interface TranslationVariant {
  text: string;
  register: Register;
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
}

interface LanguageTranslation {
  text: string;
  cefr: CefrLevel;
  transcription?: string;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
  expressionType?: ExpressionType;   // defaults to 'literal'
  equivalentNote?: string;            // explanation for idiomatic equivalents
  alternatives?: TranslationVariant[]; // up to 2 alternative translations with own register & synonyms
}

/** Detected input type — drives prompt, schema, and validation behavior */
type InputType = "word" | "phrase" | "sentence";

interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];   // array, 1–4 languages
  topic?: string;
  dictionaryContext?: DictionaryContext;  // optional Wiktionary enrichment
  outputConfig?: TranslationOutputConfig; // optional output config
  inputType?: InputType;  // classified input type — drives prompt and validation
}

interface TranslationResult {
  emoji: string;
  register: Register;
  translations: Record<string, LanguageTranslation>;
}

interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
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
  register: Register;
  translations: Record<string, LanguageTranslation>;
  needsReview?: boolean;           // true when validation failed after all retries
  dictionaryContext?: DictionaryContext;  // echoed back when used
}

type GenerateObjectFn = <T>(prompt: string, schema: ZodSchema<T>, model: string, options?: { userId?: number }) => Promise<T>;
```

## Skills (Public API)

```typescript
// Main translation entry point (outputConfig flows through to prompt & schema)
async function translate(input: TranslateInput, generateObjectFn: GenerateObjectFn): Promise<TranslateOutput>;

// Single-language translation for partial regeneration
async function translateOne(
  input: TranslateInput & { targetLang: string },
  generateObjectFn: GenerateObjectFn
): Promise<LanguageTranslation>;

// Batch translation for topics (sequential, not parallel)
async function translateBatch(
  words: string[], sourceLang: string, targetLangs: string[],
  model: string, generateObjectFn: GenerateObjectFn
): Promise<TranslateOutput[]>;

// Build the AI prompt from a request (config-aware: omits sections for disabled fields)
function buildTranslationPrompt(request: TranslationRequest): string;

// Build strict retry prompt with error feedback (config-aware)
function buildStrictPrompt(request: TranslationRequest, errors: string[]): string;

// Build per-language schema, relaxing disabled fields
function buildLanguageTranslationSchema(config?: TranslationOutputConfig): ZodSchema;

// Build result schema with required language keys (config relaxes disabled fields)
function buildTranslationResultSchema(targetLangs: string[], config?: TranslationOutputConfig): ZodSchema;

// Parse and validate raw AI response
function parseResponse(raw: unknown): TranslationResult;
```

## Output Presets (Task 21)

Centralized named presets in `translation-output.presets.ts` — single source of truth. Callers must always import a preset, never construct `TranslationOutputConfig` inline.

```typescript
import { FULL_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT, SENTENCE_OUTPUT } from "@polyglot/core";
```

| Preset | Examples | Transcription | Synonyms | Alternatives | EquivalentNote |
|---|---|---|---|---|---|
| `FULL_OUTPUT` | ❌ | ✅ | ✅ | ✅ | ✅ |
| `MINIMAL_OUTPUT` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `NOTIFICATION_OUTPUT` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `SENTENCE_OUTPUT` | ❌ | ✅ | ❌ | ❌ | ❌ |

**Caller → Preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (bot interactive) | `FULL_OUTPUT` | Rich cards with all details |
| `regen.helper.ts` (regeneration) | `FULL_OUTPUT` | Same as interactive |
| `translate-mode.helper.ts` (sentence) | `SENTENCE_OUTPUT` | Minimal output for sentences — no learning metadata |
| `regen.helper.ts` (sentence regen) | `SENTENCE_OUTPUT` | Sentence regen uses same minimal preset |
| `topic.service.ts` (bulk topic translation) | `MINIMAL_OUTPUT` | Token savings for batch jobs |
| Notification word-of-the-day (future) | `NOTIFICATION_OUTPUT` | Compact push with examples |

## Translation Flow

```
0. Caller classifies input (input-classifier module → InputType)
1. Build prompt (buildTranslationPrompt — sentence-aware intro when inputType='sentence')
2. Call AI adapter (generateObjectFn with translationResultSchema)
3. Validate response (validate from validation module, passes inputType to skip semantic for sentences)
4. On PASS → return result (with dictionaryContext echoed back if provided)
5. On FAIL → console.warn({ original, retryCount, failReason }), retry with strict prompt (up to 2 retries)
6. On final FAIL → console.error({ original, retryCount, failReason }), return result with needsReview: true
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
- `translationResultSchema` — validates full AI response (emoji, register, translations map)
- `buildTranslationResultSchema(targetLangs, config?)` — builds dynamic schema with required language keys; optional `config` relaxes disabled fields (e.g. `includeExamples: false` → `examples` defaults to `[]`)
- `buildLanguageTranslationSchema(config?)` — builds per-language schema, relaxing validation for disabled fields
- `languageTranslationSchema` — validates per-language translation entry (includes optional `expressionType` defaulting to `'literal'`, optional `equivalentNote`, optional `alternatives`)
- `translationVariantSchema` — validates alternative translation variant { text, register, synonyms }
- `synonymSchema` — validates synonym { text, register }
- `exampleSchema` — validates example { context, target, native }

## File Structure

```
packages/core/src/modules/translation/
├── index.ts                           # Re-exports: translate, translateOne, translateBatch, schemas, types, ExpressionType, InputType, DictionaryContext, TranslationVariant, TranslationOutputConfig, presets (incl. SENTENCE_OUTPUT)
├── types.ts                           # TranslateInput, TranslateOutput, TranslationOutputConfig, InputType, ExpressionType, DictionaryContext, etc.
├── translation.service.ts             # translate(), translateOne(), translateBatch(), parseResponse() — passes inputType to validate()
├── translation-output.presets.ts      # FULL_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT, SENTENCE_OUTPUT presets
├── prompt.builder.ts                  # buildTranslationPrompt(), buildStrictPrompt(), buildDictionaryHint() — config-aware, sentence-aware
├── schemas/
│   └── translation.schema.ts          # Zod schemas for AI response, buildLanguageTranslationSchema(config?)
└── __tests__/
    ├── translation.schema.test.ts     # 32 tests
    ├── prompt.builder.test.ts         # 33 tests (incl. alternatives + variant guidance + sentence-aware prompt)
    ├── translation.service.test.ts    # 27 tests (incl. translateOne + validation logging + alternatives + dictionary context passthrough)
    ├── idiomatic-equivalents.test.ts  # 18 tests (schema + prompt idiomatic features)
    ├── dictionary-context.test.ts     # 30 tests (prompt enrichment + passthrough + edge cases + multi-variant guidance)
    └── output-config.test.ts          # 29 tests (presets incl. SENTENCE_OUTPUT, config-aware prompt/schema builder, sentence service integration)
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
