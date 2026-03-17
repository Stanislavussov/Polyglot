---
name: idiom-analysis
description: Analyzes translation quality for idiomatic correctness. Detects literal vs natural translations, compares semantic meaning, and suggests alternatives. Use when implementing or modifying translation quality assessment features.
---

# idiom-analysis Agent Skill

## Module Location

`packages/core/src/modules/idiom-analysis/` — AI-powered translation quality analysis.

**Status:** 🔲 Not yet implemented (see `docs/tasks/12-idiom-analysis.md`)

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `ai` agent (via injected `generateObjectFn`)
- **Dependents:** Bot can use for translation feedback, validation pipeline can integrate

## Rules

1. Pure module — AI function is injected, no direct dependencies
2. Returns structured analysis results with confidence scores
3. Always provides alternatives when translation is not optimal
4. Classification is deterministic given AI response

## Public API (Planned)

```typescript
// Main analysis function
async function analyzeIdiom(input: AnalyzeInput, generateObjectFn): Promise<IdiomAnalysisResult>;

// Batch analysis
async function analyzeIdiomBatch(inputs: AnalyzeInput[], generateObjectFn): Promise<IdiomAnalysisResult[]>;

// Quick review check
async function needsIdiomReview(input: AnalyzeInput, generateObjectFn): Promise<boolean>;
```

## Types (Planned)

```typescript
type IdiomClassification = 
  | 'CORRECT_IDIOMATIC_TRANSLATION'  // Natural, commonly used expression
  | 'LITERAL_BUT_UNNATURAL'          // Word-for-word, sounds artificial
  | 'INCORRECT_MEANING';             // Translation doesn't convey same meaning

interface IdiomAnalysisInput {
  sourcePhrase: string;
  sourceLang: string;
  translatedPhrase: string;
  targetLang: string;
}

interface IdiomAnalysisResult {
  sourceIsIdiomatic: boolean;
  sourceExpressionType?: 'idiom' | 'proverb' | 'slang' | 'figurative' | 'fixed_expression';
  sourceLiteralMeaning?: string;
  sourceIntendedMeaning: string;
  
  classification: IdiomClassification;
  confidence: number;  // 0-1
  
  toneMatch: boolean;
  intensityMatch: boolean;
  
  explanation: string;
  
  suggestedAlternative?: string;
  alternativeExplanation?: string;
}
```

## File Structure (Planned)

```
packages/core/src/modules/idiom-analysis/
├── index.ts                              # Re-exports
├── types.ts                              # IdiomClassification, IdiomAnalysisInput, IdiomAnalysisResult
├── prompt.builder.ts                     # buildIdiomAnalysisPrompt()
├── idiom-analysis.service.ts             # analyzeIdiom(), analyzeIdiomBatch(), needsIdiomReview()
├── schemas/
│   └── idiom-analysis.schema.ts          # Zod schemas
└── __tests__/
    ├── idiom-analysis.schema.test.ts
    ├── prompt.builder.test.ts
    └── idiom-analysis.service.test.ts
```

## Reference

- Task: `docs/tasks/12-idiom-analysis.md`
- Related: Task 10 (idiomatic equivalents in translation)
- AI adapter: `.pi/skills/ai/SKILL.md`
- Validation: `.pi/skills/validation/SKILL.md`
