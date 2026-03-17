# Task 10: Idiomatic & Proverb Equivalent Matching

**Status:** ✅ Done

## Description

When a user translates a proverb, idiom, slang expression, or culturally-bound phrase, the AI currently returns a literal word-for-word translation which is often meaningless or unnatural in the target language.

**Example:** Translating the Czech proverb *"Vlk se nažral a koza zůstala celá"* (literally: the wolf ate yet the goat survived) into English should return the English idiom *"Having your cake and eating it too"* — not a nonsensical literal rendering.

The system should detect such expressions and find the **closest functional equivalent** (proverb, idiom, slang term, or common speech expression) in each target language that conveys the same meaning.

**References:**

- `tech-reqs/08-ai-prompt.md` (prompt structure)
- Task 06 (token optimization — compatible, prompt still within budget)
- Task 07 (partial regeneration — compatible, same prompt builder)

---

## Root Cause

The current prompt in `packages/core/src/modules/translation/prompt.builder.ts` instructs the AI to translate a word/phrase but gives no guidance on handling idiomatic expressions. The AI defaults to literal translation, producing unnatural results.

Additionally, the validation layer in `example.validator.ts` enforces strict word-matching between examples and the translated text. When an idiomatic equivalent uses completely different words than a literal translation would, this causes false-positive validation failures and unnecessary retries.

---

## Subtasks

### Step 1: Update types

- [x] In `packages/core/src/modules/translation/types.ts`:
  - Add `ExpressionType` union type: `'literal' | 'idiomatic_equivalent'`
  - Add optional fields to `LanguageTranslation` interface:
    - `expressionType?: ExpressionType` — signals whether the translation is literal or an idiomatic equivalent
    - `equivalentNote?: string` — a short note in the source language explaining why an equivalent was chosen (e.g. *"No direct equivalent; closest English idiom used"*)

### Step 2: Update translation schema

- [x] In `packages/core/src/modules/translation/schemas/translation.schema.ts`:
  - Add to `languageTranslationSchema`:
    ```ts
    expressionType: z.enum(['literal', 'idiomatic_equivalent']).optional().default('literal'),
    equivalentNote: z.string().optional(),
    ```
  - Both fields are optional — all existing data remains valid

### Step 3: Update prompt builder

- [x] In `packages/core/src/modules/translation/prompt.builder.ts`:
  - Add an **Idiomatic & Proverb Rule** block to `buildTranslationPrompt()` (and `buildStrictPrompt()` if present) after the existing rules:
    ```
    Idiomatic & Proverb Rule:
    - If the input is a proverb, idiom, fixed expression, or culturally-bound phrase
      that has no natural direct equivalent in a target language, provide the CLOSEST
      FUNCTIONAL EQUIVALENT in that language (a proverb, idiom, slang term, or common
      speech expression that conveys the same meaning).
    - In this case, set expressionType to "idiomatic_equivalent" and provide a brief
      equivalentNote explaining the choice.
    - If a direct translation exists and is natural, set expressionType to "literal"
      (or omit it).
    - NEVER return a meaningless word-for-word rendering of an idiomatic expression
      when a functional equivalent exists.
    ```
  - Update the JSON example in the prompt to include the new optional fields

### Step 4: Update example validator

- [x] In `packages/core/src/modules/validation/validators/example.validator.ts`:
  - When `expressionType === 'idiomatic_equivalent'`, **relax** the word-matching requirement:
    - Instead of checking that examples contain the translated word/phrase, verify only that examples are non-empty and have both target and native text
  - **Rationale:** An idiomatic equivalent is a whole phrase; its usage examples may not repeat the idiom verbatim (e.g. *"having your cake and eating it too"* used in context may not contain all words in every example)
  - Literal translations (`expressionType === 'literal'` or unset) keep the existing strict word-matching

### Step 5: Update AI prompt documentation

- [x] In `docs/tech-reqs/08-ai-prompt.md`:
  - Add the idiomatic rule to the documented prompt structure
  - Add `expressionType` and `equivalentNote` to the JSON response example

### Step 6: Write tests

- [x] **Schema tests** — `expressionType` and `equivalentNote` are accepted and validated; defaults work correctly
- [x] **Prompt tests** — prompt output includes the idiomatic rule text
- [x] **Validator tests** — example validator accepts `expressionType` parameter; validates for both `'literal'` and `'idiomatic_equivalent'`
- [x] All existing tests pass without modification (367 tests, 25 files)

### Step 7: Manual smoke test

- [x] Translate a known proverb (e.g. Czech *"Bez práce nejsou koláče"* or English *"The early bird catches the worm"*) and verify:
  - The AI returns a culturally meaningful equivalent, not a literal rendering
  - `expressionType` is set to `'idiomatic_equivalent'`
  - `equivalentNote` explains the choice

---

## Architecture Constraints

| Package                          | Change scope                          | Notes                                                        |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `packages/core/` (translation)   | Types, schema, prompt builder         | Main change area — add fields + idiomatic rule to prompt     |
| `packages/core/` (validation)    | Example validator                     | Relax word-matching for idiomatic equivalents                |
| `docs/tech-reqs/`               | Prompt documentation                  | Document new rule and response fields                        |
| `apps/bot/`                      | No changes                            | Bot renders `text` field as before — transparent             |
| `packages/adapters/db/`          | No changes                            | DB stores translations as-is                                 |
| `packages/adapters/ai/`          | No changes                            | AI adapter is schema-agnostic                                |

---

## Files Created/Modified

- `packages/core/src/modules/translation/types.ts` — added `ExpressionType`, `expressionType?`, `equivalentNote?`
- `packages/core/src/modules/translation/schemas/translation.schema.ts` — added `expressionType` (optional, defaults to `"literal"`) and `equivalentNote` (optional) to `languageTranslationSchema`
- `packages/core/src/modules/translation/prompt.builder.ts` — added Idiomatic & Proverb Rule block; added `expressionType` and `equivalentNote` to JSON template; updated strict prompt guidance
- `packages/core/src/modules/validation/validators/example.validator.ts` — added `ExpressionType` type and optional `expressionType` parameter to `validateExamples()`
- `docs/tech-reqs/08-ai-prompt.md` — documented idiomatic rule, `expressionType`, and `equivalentNote` fields
- `packages/core/src/modules/translation/__tests__/idiomatic-equivalents.test.ts` — 18 tests for schema + prompt idiomatic features
- `packages/core/src/modules/validation/__tests__/example.validator.idiomatic.test.ts` — 8 tests for validator with expressionType

---

## Key Risks & Mitigations

| Risk                                                   | Mitigation                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| AI ignores idiomatic rule and still returns literal     | Explicit "NEVER return meaningless word-for-word" instruction; strict prompt wording                    |
| Prompt token increase                                  | ~80-100 extra tokens — still well within budget even after Task 06 optimization (~230-250 total)        |
| Validation too relaxed for idiomatic equivalents        | Relaxation is narrowly scoped: only when `expressionType === 'idiomatic_equivalent'`; literals unchanged |
| One language has literal equivalent, another doesn't    | `expressionType` is per-language, not top-level — each language independently signals its approach       |
| Bot rendering breaks with new fields                   | `text` remains the single display field; `expressionType` and `equivalentNote` are metadata only        |

---

## Acceptance Criteria

- [x] Translating a well-known proverb returns a culturally equivalent expression in target languages rather than a word-for-word rendering
- [x] `expressionType` field is present in the response when an idiomatic equivalent is used
- [x] `equivalentNote` provides a brief explanation in the source language
- [x] Validation does not trigger retries for idiomatic equivalents whose examples don't repeat the phrase verbatim
- [x] Literal translations are unaffected — strict word-matching still applies
- [x] All existing tests pass without modification
- [x] New tests cover schema, prompt, and validator changes
- [x] All packages build: `pnpm -r run build`
