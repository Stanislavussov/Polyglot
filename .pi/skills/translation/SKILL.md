---
name: translation
description: Word and phrase translation via AI with prompt building, response parsing, and validation. Provides translate() and translateBatch() as the single entry points for all translation operations. Use when implementing or modifying translation logic, prompts, or response schemas.
---

# translation Agent Skill

## Module Location

`packages/core/src/` — specifically the `modules/translation/` subdirectory (to be created following `docs/tech-reqs/02-architecture.md`).

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `ai` agent (for AI requests), `validation` agent (for response validation)
- **Dependents:** `topics` agent calls translateBatch(), `bot` agent calls translate()

## Current State

`packages/core/src/index.ts` is empty (`export {}`). Everything needs to be implemented.

## Rules

1. One method `translate()` — the single entry point
2. Does not save results — only returns them
3. Knows nothing about the user — works only with text and languages
4. Always calls the `validation` agent before returning a result

## AI Prompt Structure

```
Translate "{word}" from {sourceLang} to {targetLangs[]}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "emoji": "<one relevant emoji>",
  "register": "slang | colloquial | neutral | literary | professional",
  "translations": {
    "{lang}": {
      "text": "<translation>",
      "register": "...",
      "synonyms": [{ "text": "<synonym>", "register": "..." }],
      "examples": [
        "<formal example sentence>",
        "<casual example sentence>",
        "<professional/specific context>"
      ]
    }
  }
}
```

## Skills (Public API)

```typescript
// Main translation entry point
async function translate(input: TranslateInput): Promise<TranslateOutput>;

// Batch translation for topics (calls AI in batch, not one-by-one)
async function translateBatch(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string
): Promise<TranslateOutput[]>;

// Build the AI prompt from input (internal, but testable)
function buildPrompt(input: TranslateInput): string;

// Parse and validate raw AI response (internal, but testable)
function parseResponse(raw: unknown): TranslateOutput;
```

## Types

```typescript
interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
  model: string;
}

interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  register: Register;
  translations: Record<string, TranslationEntry>;
}

interface TranslationEntry {
  text: string;
  register: Register;
  synonyms: Synonym[];
  examples: string[];
}

interface Synonym {
  text: string;
  register: Register;
}

type Register = "slang" | "colloquial" | "neutral" | "literary" | "professional";
```

## Zod Schema

The response schema should be defined with Zod for use with `ai.generateObject()` and `validation.validateSchema()`.

## File Structure

```
packages/core/src/modules/translation/
├── index.ts                    # Re-exports: translate, translateBatch
├── types.ts                    # TranslateInput, TranslateOutput, etc.
├── translation.service.ts      # translate(), translateBatch()
├── prompt.builder.ts           # buildPrompt()
└── schemas/
    └── translation.schema.ts   # Zod schema for AI response
```

## Reference

- AI prompt structure: `docs/tech-reqs/08-ai-prompt.md`
- AI validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (translation section)
