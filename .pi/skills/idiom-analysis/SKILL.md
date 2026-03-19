---
name: idiom-analysis
description: Analyzes translation quality for idiomatic correctness. Detects literal vs natural translations, compares semantic meaning, and suggests alternatives. Use when implementing or modifying translation quality assessment features.
---

# idiom-analysis Agent Skill

## Module Location

`packages/core/src/modules/idiom-analysis/` — AI-powered translation quality analysis.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `ai` agent (via injected `generateObjectFn`)
- **Dependents:** Bot can use for translation feedback, validation pipeline can integrate

## Current State

✅ **Fully Implemented**

- Types for classification, input, and result
- Zod schemas for AI response validation
- Prompt builder for analysis requests
- Service functions: `analyzeIdiom`, `analyzeIdiomBatch`, `needsIdiomReview`
- Complete test coverage

## File Structure

```
packages/core/src/modules/idiom-analysis/
├── index.ts                              # Re-exports
├── types.ts                              # IdiomClassification, IdiomAnalysisInput, IdiomAnalysisResult
├── prompt.builder.ts                     # buildIdiomAnalysisPrompt()
├── idiom-analysis.service.ts             # analyzeIdiom(), analyzeIdiomBatch(), needsIdiomReview()
├── schemas/
│   └── idiom-analysis.schema.ts          # Zod schemas
└── __tests__/
    ├── idiom-analysis.schema.test.ts     # Schema validation tests
    ├── prompt.builder.test.ts            # Prompt generation tests
    └── idiom-analysis.service.test.ts    # Service function tests
```

## Rules

1. Pure module — AI function is injected, no direct dependencies
2. Returns structured analysis results with confidence scores
3. Always provides alternatives when translation is not optimal
4. Classification is deterministic given AI response
5. For phraseologisms without direct equivalents in target language, suggests contextually appropriate translations (not literal)

## Skills (Public API)

```typescript
// Main analysis function
async function analyzeIdiom(
  input: AnalyzeInput,
  generateObjectFn: GenerateObjectFn
): Promise<IdiomAnalysisResult>;

// Batch analysis
async function analyzeIdiomBatch(
  inputs: AnalyzeInput[],
  generateObjectFn: GenerateObjectFn
): Promise<IdiomAnalysisResult[]>;

// Quick review check
async function needsIdiomReview(
  input: AnalyzeInput,
  generateObjectFn: GenerateObjectFn
): Promise<boolean>;

// Prompt builder
function buildIdiomAnalysisPrompt(input: IdiomAnalysisInput): string;
```

## Types

```typescript
type IdiomClassification =
  | 'CORRECT_IDIOMATIC_TRANSLATION'  // Natural, commonly used expression
  | 'LITERAL_BUT_UNNATURAL'          // Word-for-word, sounds artificial
  | 'INCORRECT_MEANING';             // Translation doesn't convey same meaning

type SourceExpressionType =
  | 'idiom'
  | 'proverb'
  | 'slang'
  | 'figurative'
  | 'fixed_expression';

interface IdiomAnalysisInput {
  sourcePhrase: string;
  sourceLang: string;
  translatedPhrase: string;
  targetLang: string;
}

interface IdiomAnalysisResult {
  sourceIsIdiomatic: boolean;
  sourceExpressionType?: SourceExpressionType;
  sourceLiteralMeaning?: string;
  sourceIntendedMeaning: string;
  classification: IdiomClassification;
  confidence: number;
  toneMatch: boolean;
  intensityMatch: boolean;
  explanation: string;
  suggestedAlternative?: string;
  alternativeExplanation?: string;
}

interface AnalyzeInput extends IdiomAnalysisInput {
  model: string;
}

type GenerateObjectFn = <T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string
) => Promise<T>;
```

## Usage Example

```typescript
import { analyzeIdiom, needsIdiomReview } from '@polyglot/core';
import { generateObject } from '@polyglot/ai';

// Full analysis
const result = await analyzeIdiom(
  {
    sourcePhrase: 'Break a leg',
    sourceLang: 'English',
    translatedPhrase: 'Zlom si nohu',
    targetLang: 'Czech',
    model: 'openrouter/anthropic/claude-sonnet-4',
  },
  generateObject
);

// result.classification: 'LITERAL_BUT_UNNATURAL'
// result.suggestedAlternative: 'Zlom vaz' or 'Drž palce'

// Quick check
const needsReview = await needsIdiomReview(input, generateObject);
if (needsReview) {
  // Translation may be unnatural, get full analysis
}
```

## Reference

- Task: `docs/tasks/12-idiom-analysis.md`
- Related: Task 10 (idiomatic equivalents in translation)
- Tech Req: `tech-reqs/07-ai-validation.md`
