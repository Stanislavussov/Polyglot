# Task 57 — Source Language Examples (Revised Design)

**Status:** 🔲 To Do  
**Type:** Feature (enricher + persistence + rendering)  
**Priority:** Medium — enhances learning with bilingual example sentences  
**Effort Estimate:** 5–7 hours

---

## Goal

Add **source language examples** to translation output by computing them on-demand via reverse translation, persisting to DB, and displaying alongside target examples as bilingual sentence pairs.

This replaces the original design (storing `src` in `Example` objects) with a more flexible architecture: source sentences are computed lazily at render time, cached in the DB, and displayed as `target ↔ src` pairs.

## Design Decisions

| #   | Decision                                 | Rationale                                                            |
| --- | ---------------------------------------- | -------------------------------------------------------------------- |
| 1   | On-demand computation                    | Avoids prompting AI twice; flexibility to recompute                  |
| 2   | Persist to DB                            | Avoids re-computing on every render; cached across sessions          |
| 3   | Renderer-side enricher                   | Simple, explicit: "enrich before render"                             |
| 4   | Reverse translation                      | Compute `src` by translating target→source                           |
| 5   | Batch call                               | All examples translated in single `translateBatch()` call            |
| 6   | Silent fail                              | Enhancement only; no retry, no error shown                           |
| 7   | Side-by-side display                     | Compact bilingual format with ↔ separator                            |
| 8   | `sourceExamples: Record<number, string>` | Compact storage, keyed by example index                              |
| 9   | Default empty object                     | No NULL checks needed                                                |
| 10  | Compute + persist                        | Self-contained operation; caller doesn't manage persistence          |
| 11  | Bot layer location                       | Orchestrates DB + translation service; core stays pure               |
| 12  | Config flag                              | `includeSourceExamples: true` triggers computation                   |
| 13  | Prerequisite rule                        | `src` requires `examples` enabled; flag ignored if examples disabled |

---

## Architecture

```
User Input → translate() → Translation (stored, examples: target-only)
                                       ↓
                              Translation Scene
                                       ↓
                              Enricher (conditionally)
                                       ↓
                              Batch compute src (target→source)
                                       ↓
                              Persist to Translation.sourceExamples
                                       ↓
                              Renderer displays bilingual pairs
```

---

## Implementation Plan

### Step 1: Extend `TranslationOutputConfig` (0.5h)

**File:** `packages/core/src/shared/types.ts`

```typescript
interface TranslationOutputConfig {
  includeExamples?: boolean; // existing
  includeTranscription?: boolean; // existing
  includeSynonyms?: boolean; // existing
  includeSourceExamples?: boolean; // NEW — default: false
}
```

### Step 2: Add `sourceExamples` Column to Schema (1h)

**File:** `packages/adapters/db/src/schema.ts`

```typescript
// In translations table
sourceExamples: jsonb("source_examples").default({}).notNull(),
```

**Migration:** Add `source_examples` column as JSONB with default `{}`.

### Step 3: Create Example Source Enricher (2h)

**File:** `apps/bot/src/enrichers/example-src.enricher.ts` (NEW)

```typescript
export async function enrichExamplesWithSrc(params: {
  translation: Translation;
  sourceLang: string;
  targetLang: string;
  translateBatch: (
    texts: string[],
    targetLang: string,
    sourceLang: string,
  ) => Promise<TranslateOutput[]>;
  translationRepo: TranslationRepository;
}): Promise<Translation> {
  // 1. Check preconditions
  // 2. Extract target sentences from examples
  // 3. Batch translate (targetLang → sourceLang)
  // 4. Build sourceExamples record: { 0: "...", 1: "...", 2: "..." }
  // 5. Persist to DB
  // 6. Return enriched translation
}
```

**Preconditions:**

- `translation.outputConfig.includeSourceExamples === true`
- `translation.examples.length > 0`
- `Object.keys(translation.sourceExamples).length === 0` (not already cached)

**Batch translation:**

- Input: array of `example.target` strings
- Direction: targetLang → sourceLang (reversed!)
- Output: `TranslateOutput[]` with translated sentences

**Persistence:**

- Write `{ 0: src0, 1: src1, 2: src2 }` to `translation.sourceExamples`
- Re-read from DB to ensure consistency

**Failure handling:**

- Silent fail — if translation service fails, return translation unchanged
- `sourceExamples` remains empty, renderer shows target-only examples

### Step 4: Integrate Enricher in Scene (0.5h)

**File:** `apps/bot/src/scenes/translation.scene.ts`

Before calling renderer:

```typescript
// After translation is stored
if (
  translation.outputConfig?.includeSourceExamples &&
  translation.examples.length > 0
) {
  const enriched = await enrichExamplesWithSrc({
    translation,
    sourceLang: translation.sourceLang,
    targetLang: targetLang,
    translateBatch: translationService.translateBatch.bind(translationService),
    translationRepo,
  });
  translation = enriched;
}
```

### Step 5: Update Renderer (1h)

**File:** `apps/bot/src/renderers/translation.renderer.ts`

When rendering examples, check for `sourceExamples`:

```typescript
for (const [index, example] of translation.examples.entries()) {
  const src = translation.sourceExamples[index];

  if (src) {
    // Bilingual pair: target ↔ src
    line += `${example.target} ↔ ${src}`;
  } else {
    // Target only (default or failed)
    line += example.target;
  }
}
```

Format: `"This translation is very difficult. ↔ Этот перевод очень сложный."`

### Step 6: Tests (2h)

**Unit tests:**

- `enricher.test.ts`: Verify batching, DB persistence, silent fail, precondition checks
- `renderer.test.ts`: Verify bilingual display when `sourceExamples` present

**Integration test:**

- Full flow: translate → enrich → render → verify bilingual output

---

## Acceptance Criteria

- [ ] `includeSourceExamples` flag added to `TranslationOutputConfig` (default: false)
- [ ] `sourceExamples` column added to translations table (JSONB, default `{}`)
- [ ] Enricher computes source sentences via batch reverse translation
- [ ] Enricher persists computed values to DB
- [ ] Enricher fails silently on translation service errors
- [ ] Renderer displays `target ↔ src` for bilingual examples
- [ ] Renderer falls back to target-only when `src` is missing
- [ ] Enricher only runs when preconditions met (flag true, examples exist, cache empty)
- [ ] If `includeExamples: false`, `src` is never computed (flag ignored)
- [ ] Existing tests pass without modification
- [ ] New tests cover enricher and renderer changes

---

## Files Affected

| File                                                  | Change                                |
| ----------------------------------------------------- | ------------------------------------- |
| `packages/core/src/shared/types.ts`                   | Add `includeSourceExamples?: boolean` |
| `packages/adapters/db/src/schema.ts`                  | Add `sourceExamples` JSONB column     |
| `db/migrations/xxx_add_source_examples.ts`            | Migration for new column              |
| `apps/bot/src/enrichers/example-src.enricher.ts`      | **NEW** — compute + persist src       |
| `apps/bot/src/enrichers/index.ts`                     | Export enricher                       |
| `apps/bot/src/scenes/translation.scene.ts`            | Call enricher before render           |
| `apps/bot/src/renderers/translation.renderer.ts`      | Render bilingual pairs                |
| `apps/bot/src/__tests__/example-src.enricher.test.ts` | **NEW** — enricher tests              |
| `apps/bot/src/__tests__/translation.renderer.test.ts` | Update for bilingual display          |

---

## What NOT to Change (vs. original task)

- ❌ `Example` interface — no `src` field added
- ❌ Zod schema in translation service — no changes needed
- ❌ Prompt builder — no changes to AI prompts
- ❌ Translation service — no changes to `translate()` or `translateBatch()`

---

## Example Output

**Stored in DB:**

```json
{
  "id": 123,
  "examples": [
    {
      "context": "neutral",
      "target": "This translation is very difficult.",
      "register": "neutral"
    },
    {
      "context": "colloquial",
      "target": "I'm stuck on this translation.",
      "register": "colloquial"
    }
  ],
  "sourceExamples": {
    "0": "Этот перевод очень сложный.",
    "1": "Я застрял на этом переводе."
  }
}
```

**Rendered output:**

```
📝 Перевод — translation

🔹 neutral
   This translation is very difficult. ↔ Этот перевод очень сложный.
   I'm stuck on this translation. ↔ Я застрял на этом переводе.

🔹 colloquial
   ...
```
