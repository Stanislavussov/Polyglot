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

Fully implemented with types, Zod schemas, prompt builder, and translation service with validation pipeline. Structured logging added: `console.warn` on each failed validation attempt and `console.error` after all retries exhausted (core stays infra-free per architecture constraints).

## Rules

1. One method `translate()` — the single entry point
2. Does not save results — only returns them
3. Knows nothing about the user — works only with text and languages
4. Always calls the `validation` agent before returning a result
5. AI generation function is injected (no direct dependency on AI adapter from core)

## Types

```typescript
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
- `languageTranslationSchema` — validates per-language translation entry
- `synonymSchema` — validates synonym { text, register }
- `exampleSchema` — validates example { context, target, native }

## File Structure

```
packages/core/src/modules/translation/
├── index.ts                    # Re-exports: translate, translateBatch, schemas, types
├── types.ts                    # TranslateInput, TranslateOutput, etc.
├── translation.service.ts      # translate(), translateBatch(), parseResponse()
├── prompt.builder.ts           # buildTranslationPrompt(), buildStrictPrompt()
├── schemas/
│   └── translation.schema.ts   # Zod schemas for AI response
└── __tests__/
    ├── translation.schema.test.ts   # 28 tests
    ├── prompt.builder.test.ts       # 19 tests
    └── translation.service.test.ts  # 21 tests (incl. 5 validation logging tests)
```

## Reference

- AI prompt structure: `docs/tech-reqs/08-ai-prompt.md`
- AI validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (translation section)
- BRD § 6.1 (Word/Phrase Translation), § 10 (AI Response Schema)
