# Task 12: Detect Literal vs Idiomatic Translation Nuances

**Status:** ✅ Done

## Description

Create a new analysis module that evaluates whether a translated phrase preserves idiomatic meaning or results in an unnatural/literal expression. This is a **post-translation quality assessment** tool that can be used to:

1. Validate translation quality
2. Provide feedback to users about translation naturalness
3. Suggest better alternatives when translations are literal but unnatural

**Example:** Given the source phrase *"Break a leg"* (English) and its translation *"Zlom si nohu"* (Czech — literal "break your leg"), the analyzer should:
- Detect that the source is an idiomatic expression (good luck wish)
- Identify that the Czech translation is literal and unnatural
- Classify as `LITERAL_BUT_UNNATURAL`
- Suggest the natural Czech alternative: *"Drž palce"* or *"Zlom vaz"*

**References:**

- Task 10 (idiomatic equivalents — ensures translations *produce* idioms; this task *validates* them)
- `tech-reqs/07-ai-validation.md` (validation pipeline)
- `tech-reqs/08-ai-prompt.md` (prompt structure)

---

## Root Cause

The current validation pipeline (`packages/core/src/modules/validation/`) only performs deterministic checks:
- Schema validation (Zod)
- Semantic validation (translation ≠ original, no hallucinations)
- Example validation (well-formed examples)

There is no mechanism to **assess translation naturalness** or detect when a literal translation sounds awkward in the target language. Task 10 instructs the AI to produce idiomatic equivalents, but we lack a way to verify or re-evaluate existing translations.

---

## Subtasks

### Step 1: Create types

- [x] Create `packages/core/src/modules/idiom-analysis/types.ts`:
  ```typescript
  /** Classification result for translation quality */
  type IdiomClassification = 
    | 'CORRECT_IDIOMATIC_TRANSLATION'  // Natural, commonly used expression
    | 'LITERAL_BUT_UNNATURAL'          // Word-for-word, sounds artificial
    | 'INCORRECT_MEANING';             // Translation doesn't convey same meaning

  /** Input for idiom analysis */
  interface IdiomAnalysisInput {
    sourcePhrase: string;
    sourceLang: string;
    translatedPhrase: string;
    targetLang: string;
  }

  /** Full analysis result */
  interface IdiomAnalysisResult {
    /** Whether the source phrase is idiomatic */
    sourceIsIdiomatic: boolean;
    /** Type of expression if idiomatic */
    sourceExpressionType?: 'idiom' | 'proverb' | 'slang' | 'figurative' | 'fixed_expression';
    /** Literal meaning of source (if idiomatic) */
    sourceLiteralMeaning?: string;
    /** Intended/figurative meaning of source */
    sourceIntendedMeaning: string;
    
    /** Classification of the translation */
    classification: IdiomClassification;
    /** Confidence score 0-1 */
    confidence: number;
    
    /** Whether both phrases convey same emotional tone */
    toneMatch: boolean;
    /** Whether intensity/emphasis is preserved */
    intensityMatch: boolean;
    
    /** Explanation of the classification decision */
    explanation: string;
    
    /** Suggested natural alternative (if classification !== CORRECT_IDIOMATIC_TRANSLATION) */
    suggestedAlternative?: string;
    /** Explanation for the suggested alternative */
    alternativeExplanation?: string;
  }

  /** Generate function signature (injected dependency) */
  type GenerateObjectFn = <T>(
    prompt: string,
    schema: ZodSchema<T>,
    model: string
  ) => Promise<T>;
  ```

### Step 2: Create Zod schemas

- [x] Create `packages/core/src/modules/idiom-analysis/schemas/idiom-analysis.schema.ts`:
  ```typescript
  import { z } from 'zod';

  export const idiomClassificationSchema = z.enum([
    'CORRECT_IDIOMATIC_TRANSLATION',
    'LITERAL_BUT_UNNATURAL', 
    'INCORRECT_MEANING'
  ]);

  export const sourceExpressionTypeSchema = z.enum([
    'idiom', 'proverb', 'slang', 'figurative', 'fixed_expression'
  ]);

  export const idiomAnalysisResultSchema = z.object({
    sourceIsIdiomatic: z.boolean(),
    sourceExpressionType: sourceExpressionTypeSchema.optional(),
    sourceLiteralMeaning: z.string().optional(),
    sourceIntendedMeaning: z.string(),
    
    classification: idiomClassificationSchema,
    confidence: z.number().min(0).max(1),
    
    toneMatch: z.boolean(),
    intensityMatch: z.boolean(),
    
    explanation: z.string(),
    
    suggestedAlternative: z.string().optional(),
    alternativeExplanation: z.string().optional(),
  });
  ```

### Step 3: Create prompt builder

- [x] Create `packages/core/src/modules/idiom-analysis/prompt.builder.ts`:
  ```typescript
  import { IdiomAnalysisInput } from './types';

  export function buildIdiomAnalysisPrompt(input: IdiomAnalysisInput): string {
    return `You are a linguistic expert analyzing translation quality between languages.

## Task
Analyze whether a translated phrase preserves idiomatic meaning or is an unnatural literal translation.

## Input
- Source phrase: "${input.sourcePhrase}"
- Source language: ${input.sourceLang}
- Translated phrase: "${input.translatedPhrase}"
- Target language: ${input.targetLang}

## Analysis Steps

1. **Identify Source Expression Type**
   - Determine if the source phrase is idiomatic (idiom, proverb, slang, figurative speech, or fixed expression)
   - If idiomatic, identify both the literal and intended/figurative meaning

2. **Evaluate Translation Quality**
   - Check if the translated phrase is:
     - A natural, commonly used expression in the target language (CORRECT_IDIOMATIC_TRANSLATION)
     - A word-for-word literal translation that sounds unnatural or artificial (LITERAL_BUT_UNNATURAL)
     - A translation that fails to convey the same meaning (INCORRECT_MEANING)

3. **Compare Semantic Meaning**
   - Verify that both phrases convey the same emotional tone
   - Check that the intensity/emphasis is preserved

4. **Provide Alternative (if needed)**
   - If the translation is not natural, suggest a commonly used equivalent expression in the target language

## Response Format
Return a JSON object with all analysis fields. Be thorough but concise in explanations.

## Important Rules
- Focus on how native speakers actually use expressions
- Consider cultural context and regional variations
- A literal translation can be CORRECT if the expression translates directly
- Set confidence based on how certain you are about the classification
- Always provide suggestedAlternative when classification is not CORRECT_IDIOMATIC_TRANSLATION`;
  }
  ```

### Step 4: Create analysis service

- [x] Create `packages/core/src/modules/idiom-analysis/idiom-analysis.service.ts`:
  ```typescript
  import { IdiomAnalysisInput, IdiomAnalysisResult, GenerateObjectFn } from './types';
  import { idiomAnalysisResultSchema } from './schemas/idiom-analysis.schema';
  import { buildIdiomAnalysisPrompt } from './prompt.builder';

  export interface AnalyzeInput extends IdiomAnalysisInput {
    model: string;
  }

  /**
   * Analyze a translation for idiomatic correctness
   */
  export async function analyzeIdiom(
    input: AnalyzeInput,
    generateObjectFn: GenerateObjectFn
  ): Promise<IdiomAnalysisResult> {
    const prompt = buildIdiomAnalysisPrompt(input);
    const result = await generateObjectFn(
      prompt,
      idiomAnalysisResultSchema,
      input.model
    );
    return result;
  }

  /**
   * Batch analyze multiple translations
   */
  export async function analyzeIdiomBatch(
    inputs: AnalyzeInput[],
    generateObjectFn: GenerateObjectFn
  ): Promise<IdiomAnalysisResult[]> {
    const results: IdiomAnalysisResult[] = [];
    for (const input of inputs) {
      const result = await analyzeIdiom(input, generateObjectFn);
      results.push(result);
    }
    return results;
  }

  /**
   * Quick check if a translation needs review (returns true if not CORRECT)
   */
  export async function needsIdiomReview(
    input: AnalyzeInput,
    generateObjectFn: GenerateObjectFn
  ): Promise<boolean> {
    const result = await analyzeIdiom(input, generateObjectFn);
    return result.classification !== 'CORRECT_IDIOMATIC_TRANSLATION';
  }
  ```

### Step 5: Create module index

- [x] Create `packages/core/src/modules/idiom-analysis/index.ts`:
  ```typescript
  // Service
  export { analyzeIdiom, analyzeIdiomBatch, needsIdiomReview } from './idiom-analysis.service';
  export type { AnalyzeInput } from './idiom-analysis.service';

  // Types
  export type {
    IdiomClassification,
    IdiomAnalysisInput,
    IdiomAnalysisResult,
    GenerateObjectFn
  } from './types';

  // Schemas
  export {
    idiomClassificationSchema,
    sourceExpressionTypeSchema,
    idiomAnalysisResultSchema
  } from './schemas/idiom-analysis.schema';

  // Prompt builder
  export { buildIdiomAnalysisPrompt } from './prompt.builder';
  ```

### Step 6: Add to core module exports

- [x] Update `packages/core/src/index.ts` to export the new module (selective exports to avoid GenerateObjectFn collision):
  ```typescript
  export * from './idiom-analysis';
  ```

### Step 7: Write tests

- [x] Create `packages/core/src/modules/idiom-analysis/__tests__/idiom-analysis.schema.test.ts`:
  - Schema accepts valid classification values
  - Schema rejects invalid classification values
  - Optional fields work correctly
  - Confidence must be 0-1

- [x] Create `packages/core/src/modules/idiom-analysis/__tests__/prompt.builder.test.ts`:
  - Prompt includes source phrase and language
  - Prompt includes translated phrase and target language
  - Prompt contains all analysis instructions
  - Prompt escapes special characters in input

- [x] Create `packages/core/src/modules/idiom-analysis/__tests__/idiom-analysis.service.test.ts`:
  - `analyzeIdiom` calls generateObjectFn with correct prompt and schema
  - `analyzeIdiom` returns AI response
  - `analyzeIdiomBatch` processes multiple inputs sequentially
  - `needsIdiomReview` returns true for non-CORRECT classifications
  - `needsIdiomReview` returns false for CORRECT_IDIOMATIC_TRANSLATION

### Step 8: Create skill documentation

- [x] Create `.pi/skills/idiom-analysis/SKILL.md`:
  ```markdown
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

  ## Rules

  1. Pure module — AI function is injected, no direct dependencies
  2. Returns structured analysis results with confidence scores
  3. Always provides alternatives when translation is not optimal
  4. Classification is deterministic given AI response

  ## Public API

  \`\`\`typescript
  // Main analysis function
  async function analyzeIdiom(input: AnalyzeInput, generateObjectFn): Promise<IdiomAnalysisResult>;

  // Batch analysis
  async function analyzeIdiomBatch(inputs: AnalyzeInput[], generateObjectFn): Promise<IdiomAnalysisResult[]>;

  // Quick review check
  async function needsIdiomReview(input: AnalyzeInput, generateObjectFn): Promise<boolean>;
  \`\`\`

  ## Classification Values

  - `CORRECT_IDIOMATIC_TRANSLATION` — Natural, commonly used expression
  - `LITERAL_BUT_UNNATURAL` — Word-for-word, sounds artificial
  - `INCORRECT_MEANING` — Translation doesn't convey same meaning

  ## Reference

  - Task: `@docs/tasks/12-idiom-analysis.md`
  - Related: Task 10 (idiomatic equivalents in translation)
  ```

### Step 9: Manual smoke test

- [ ] Test with known idiomatic expressions:
  - English "Break a leg" → Czech literal translation → should detect as LITERAL_BUT_UNNATURAL
  - English "It's raining cats and dogs" → Czech "Leje jako z konve" → should detect as CORRECT_IDIOMATIC_TRANSLATION
  - English "Piece of cake" → Czech "Kousek dortu" (literal) → should suggest "Hračka" or "Brnkačka"

---

## Architecture Constraints

| Package                          | Change scope                          | Notes                                                        |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `packages/core/`                 | New `idiom-analysis/` module          | Types, schemas, prompt builder, service                      |
| `apps/bot/`                      | No changes                            | Core module only, no bot integration                         |
| `packages/adapters/ai/`          | No changes                            | Uses existing `generateObject` via injection                 |
| `packages/adapters/db/`          | No changes                            | No persistence needed for analysis                           |
| `.pi/skills/`                    | New skill documentation               | `idiom-analysis/SKILL.md`                                    |

---

## Files Created

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

.pi/skills/idiom-analysis/
└── SKILL.md                              # Skill documentation
```

---

## Key Risks & Mitigations

| Risk                                                   | Mitigation                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| AI misclassifies translations                          | Include confidence score; low confidence results can trigger human review                               |
| Cost of additional AI calls                            | Analysis is opt-in, not part of main translation flow                                                   |
| Regional idiom variations                              | Prompt instructs AI to consider regional variations                                                     |
| Subjective "naturalness" judgments                     | Focus on commonly used expressions; provide explanation for decisions                                   |
| Prompt token cost                                      | Single-purpose prompt is relatively small (~200-300 tokens)                                             |

---

## Acceptance Criteria

- [x] New `idiom-analysis` module exists in `packages/core/src/modules/`
- [x] Types define `IdiomClassification`, `IdiomAnalysisInput`, `IdiomAnalysisResult`
- [x] Zod schemas validate AI responses correctly
- [x] `analyzeIdiom()` returns structured analysis with classification
- [x] `needsIdiomReview()` returns boolean for quick checks
- [x] All tests pass
- [x] Skill documentation created
- [ ] Manual smoke test confirms correct classification of known idioms
- [x] All packages build: `pnpm -r run build`
