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

Fully implemented with types, Zod schemas, prompt builder, and translation service with validation pipeline. Structured logging added: `console.warn` on each failed validation attempt and `console.error` after all retries exhausted (core stays infra-free per architecture constraints). Task 07 partial regeneration: added `translateOne()` — a thin wrapper around `translate()` that translates a single target language and returns just the `LanguageTranslation`, used by the bot's per-language regeneration flow. Task 09 translate session loop: no translation module changes needed — persistent translate mode is a bot-layer routing concern; the bot's mode router calls `translate()` for each plain text message while in translate mode; i18n keys (`translateModeOn`, `translateModeHint`) were added to support mode confirmation/hint messages. Task 10 idiomatic equivalents: added `ExpressionType` type (`'literal' | 'idiomatic_equivalent'`), `expressionType` and `equivalentNote` optional fields to `LanguageTranslation` and the Zod schema, added Idiomatic & Proverb Rule block to prompt builder, and `ExpressionType` is re-exported from the module index.

## Rules

1. One method `translate()` — the single entry point
2. Does not save results — only returns them
3. Knows nothing about the user — works only with text and languages
4. Always calls the `validation` agent before returning a result
5. AI generation function is injected (no direct dependency on AI adapter from core)

## Types

```typescript
type ExpressionType = "literal" | "idiomatic_equivalent";
type Register = "slang" | "colloquial" | "neutral" | "literary" | "professional";
type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type ExampleContext = "formal" | "colloquial" | "professional";

interface Synonym { text: string; register: Register; }
interface Example { context: ExampleContext; target: string; native: string; }

interface LanguageTranslation {
  text: string;
  cefr: CefrLevel;
  transcription?: string;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
  expressionType?: ExpressionType;   // defaults to 'literal'
  equivalentNote?: string;            // explanation for idiomatic equivalents
}

interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];   // array, 1–4 languages
  topic?: string;
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
}

interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  register: Register;
  translations: Record<string, LanguageTranslation>;
  needsReview?: boolean;   // true when validation failed after all retries
}

type GenerateObjectFn = <T>(prompt: string, schema: ZodSchema<T>, model: string) => Promise<T>;
```

## Skills (Public API)

```typescript
// Main translation entry point
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

// Build the AI prompt from a request
function buildTranslationPrompt(request: TranslationRequest): string;

// Build strict retry prompt with error feedback
function buildStrictPrompt(request: TranslationRequest, errors: string[]): string;

// Parse and validate raw AI response
function parseResponse(raw: unknown): TranslationResult;
```

## Translation Flow

```
1. Build prompt (buildTranslationPrompt)
2. Call AI adapter (generateObjectFn with translationResultSchema)
3. Validate response (validate from validation module)
4. On PASS → return result
5. On FAIL → console.warn({ original, retryCount, failReason }), retry with strict prompt (up to 2 retries)
6. On final FAIL → console.error({ original, retryCount, failReason }), return result with needsReview: true
```

## Zod Schemas

- `translationRequestSchema` — validates TranslationRequest (targetLangs 1–4)
- `translationResultSchema` — validates full AI response (emoji, register, translations map)
- `buildTranslationResultSchema(targetLangs)` — builds dynamic schema with required language keys so AI SDK enforces their presence
- `languageTranslationSchema` — validates per-language translation entry (includes optional `expressionType` defaulting to `'literal'` and optional `equivalentNote`)
- `synonymSchema` — validates synonym { text, register }
- `exampleSchema` — validates example { context, target, native }

## File Structure

```
packages/core/src/modules/translation/
├── index.ts                    # Re-exports: translate, translateOne, translateBatch, schemas, types, ExpressionType
├── types.ts                    # TranslateInput, TranslateOutput, ExpressionType, etc.
├── translation.service.ts      # translate(), translateOne(), translateBatch(), parseResponse()
├── prompt.builder.ts           # buildTranslationPrompt(), buildStrictPrompt()
├── schemas/
│   └── translation.schema.ts   # Zod schemas for AI response
└── __tests__/
    ├── translation.schema.test.ts   # 32 tests
    ├── prompt.builder.test.ts       # 19 tests
    ├── translation.service.test.ts  # 27 tests (incl. 6 translateOne + 5 validation logging tests)
    └── idiomatic-equivalents.test.ts # 18 tests (schema + prompt idiomatic features)
```

## Reference

- AI prompt structure: `docs/tech-reqs/08-ai-prompt.md`
- AI validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (translation section)
- BRD § 6.1 (Word/Phrase Translation), § 10 (AI Response Schema)
