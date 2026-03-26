# Task 26: Diacritics-Aware Translation for Languages Like Czech

**Status:** 🔲 To Do

## Description

In languages with diacritical marks (Czech, Polish, Turkish, Vietnamese, Hungarian, Slovak, Croatian, Romanian, etc.), diacritics are **not decorative** — they change meaning entirely. The AI regularly drops or substitutes diacritics, producing wrong words:

| Input (RU) | AI returns (CS) | Correct (CS) | Problem |
|---|---|---|---|
| каша | kase | **kaše** | Missing háček → not a word |
| быть | byt | **být** | "byt" = apartment, "být" = to be |
| пояс | pas | **pás** | "pas" = passport, "pás" = belt |
| горячий | horuci | **horoucí** / **horký** | Garbled diacritics |

Currently **nothing** in the pipeline guards against this:
- **Prompt** — no diacritics instruction
- **Validation** — no diacritics check (semantic validator only checks translation ≠ original)
- **Language metadata** — no `hasDiacritics` flag to identify which languages need care
- **Wiktionary cross-check** — dictionary data exists in `word_context` but isn't used for post-translation verification

**References:**
- `docs/tech-reqs/08-ai-prompt.md` (prompt structure)
- `docs/tech-reqs/07-ai-validation.md` (validation pipeline)
- `docs/tech-reqs/05-db-schema.md` (languages table)
- `docs/tasks/06-token-optimization.md` (soft warnings pattern)
- `docs/tasks/15-context-enrichment-layer.md` (Wiktionary context)

---

## Current State

| Component | Diacritics awareness | Gap |
|---|---|---|
| `languages` table | ❌ No `hasDiacritics` flag | Can't identify which target languages need diacritics care |
| `prompt.builder.ts` | ❌ No diacritics rule in prompt | AI has no instruction to preserve diacritics |
| `semantic.validator.ts` | ❌ Only checks translation ≠ original | Doesn't catch `kase` vs `kaše` |
| `language.validator.ts` | ❌ No-op (franc disabled) | — |
| `word_context` table | ✅ Has correct Wiktionary headwords with diacritics | Not used for post-translation verification |
| `context-enrichment` layer | ✅ Injects pre-translation context | Only enriches *source* word, not target |

---

## Subtasks

### Step 1: Add `hasDiacritics` flag to `languages` table

Mark languages where diacritics are meaning-changing so downstream components can adapt behavior per target language.

- [ ] In `packages/adapters/db/src/schema.ts`, add to `languages` table:
  ```typescript
  /** True if language has meaning-changing diacritics (e.g. Czech ř, š, ž) */
  hasDiacritics: boolean("has_diacritics").default(false).notNull(),
  ```
- [ ] Create a Drizzle migration for the new column
- [ ] Create a data migration to set `hasDiacritics = true` for known languages:
  | Code | Language | Key diacritics |
  |------|----------|----------------|
  | cs | Czech | ř, š, ž, č, ě, ů, á, í, é, ý, ó, ú |
  | sk | Slovak | ľ, š, č, ž, ť, ď, ň, á, é, í, ó, ú, ý |
  | pl | Polish | ą, ć, ę, ł, ń, ó, ś, ź, ż |
  | hr | Croatian | č, ć, đ, š, ž |
  | sl | Slovenian | č, š, ž |
  | hu | Hungarian | á, é, í, ó, ö, ő, ú, ü, ű |
  | ro | Romanian | ă, â, î, ș, ț |
  | tr | Turkish | ç, ğ, ı, İ, ö, ş, ü |
  | vi | Vietnamese | ả, ắ, ặ, ầ, ẩ, etc. (tone marks) |
  | de | German | ä, ö, ü, ß |
  | fr | French | à, â, ç, é, è, ê, ë, î, ï, ô, ù, û, ü, ÿ |
  | es | Spanish | á, é, í, ó, ú, ñ, ü |
  | pt | Portuguese | à, á, â, ã, ç, é, ê, í, ó, ô, õ, ú |
  | lt | Lithuanian | ą, č, ę, ė, į, š, ų, ū, ž |
  | lv | Latvian | ā, č, ē, ģ, ī, ķ, ļ, ņ, š, ū, ž |
- [ ] Update `LanguageEntry` in `packages/core/src/modules/i18n/language-registry.ts` to include `hasDiacritics?: boolean`
- [ ] Update language cache in `packages/adapters/db/src/language-cache.ts` to expose the new field
- [ ] Add `getLanguagesWithDiacritics(): string[]` helper that returns codes for diacritics-sensitive languages

**Estimated Effort:** 2 hours

### Step 2: Add diacritics prompt rule for target languages

When any target language has `hasDiacritics = true`, inject an explicit diacritics instruction into the translation prompt.

- [ ] In `packages/core/src/modules/translation/prompt.builder.ts`:
  - Import `getLangHasDiacritics` (or equivalent) from the language registry
  - In `buildTranslationPrompt()`, check which target languages have diacritics
  - If any do, append a diacritics rule to the prompt Rules section:
    ```
    - DIACRITICAL MARKS ARE MANDATORY for {Czech, Polish, ...}. Diacritics change
      meaning entirely — NEVER omit or substitute them. Examples: Czech "kaše"
      (porridge) ≠ "kase" (not a word); "být" (to be) ≠ "byt" (apartment);
      "pás" (belt) ≠ "pas" (passport). Apply the correct diacritics to every
      translated word, synonym, alternative, and example sentence.
    ```
  - Generate language-specific examples dynamically (e.g., Czech gets Czech examples, Polish gets Polish examples) — or use a single generic rule
  - Also add the rule to `buildStrictPrompt()` check items
- [ ] Update tests in `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts`:
  - Assert diacritics rule appears when a diacritics-sensitive target language is present
  - Assert rule is absent when all target languages are non-diacritics (e.g., only `en`, `zh`)

**Estimated Effort:** 2 hours

### Step 3: Add diacritics validator with Wiktionary cross-check

Post-translation validation that verifies the AI's output contains proper diacritics, optionally cross-checking against Wiktionary data.

- [ ] Create `packages/core/src/modules/validation/validators/diacritics.validator.ts`:
  - **Check 1 — Diacritics presence:** For diacritics-sensitive languages, verify the translated text contains at least one character from the expected diacritical range. A fully-ASCII translation for Czech is suspicious (e.g., "kase" instead of "kaše")
    ```typescript
    // Czech: expect characters in Latin Extended-A range (0x0100–0x017F)
    // or characters with combining marks
    function hasDiacriticalChars(text: string, langCode: string): boolean
    ```
  - **Check 2 — ASCII-stripping detection:** If the translation is identical to its NFD-stripped-to-ASCII form, flag it as likely missing diacritics
    ```typescript
    function isDiacriticsStripped(text: string): boolean {
      const stripped = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return stripped === text; // true means no diacritics present
    }
    ```
  - **Check 3 (optional) — Wiktionary cross-check:** Accept an optional lookup function. If provided, check whether the AI's translation exists as a headword in `word_context` for that target language. If a stripped form exists but the exact form doesn't, flag as a diacritics error
  - Return **warnings** (not errors) — same pattern as Task 06's soft validation to avoid false-positive retries. A fully-ASCII translation of a common word might be a valid cognate (e.g., "hotel" is valid in Czech)
- [ ] Export from `packages/core/src/modules/validation/index.ts`
- [ ] In `validate()` orchestrator, call the new diacritics validator for languages where `hasDiacritics` is true:
  - The validator needs to know which languages have diacritics — either pass a list or a lookup function
  - Collect results into `warnings` (requires `warnings` field from Task 06, or a standalone soft-error mechanism)
- [ ] Add tests in `packages/core/src/modules/validation/__tests__/diacritics.validator.test.ts`:
  ```typescript
  // should pass: correct diacritics
  validateDiacritics("kaše", "cs")  // → valid, no warnings
  validateDiacritics("být", "cs")    // → valid

  // should warn: missing diacritics
  validateDiacritics("kase", "cs")   // → warning: likely missing diacritics
  validateDiacritics("byt", "cs")    // → warning (could mean "apartment", so soft)
  validateDiacritics("horuci", "cs") // → warning: garbled Czech

  // should pass: non-diacritics language
  validateDiacritics("hello", "en")  // → valid (English doesn't require diacritics)

  // should pass: valid ASCII word in diacritics language
  validateDiacritics("hotel", "cs")  // → valid (legitimate loanword)
  ```

**Estimated Effort:** 3–4 hours

### Step 4: Wire diacritics awareness into the translation flow

Connect the new flag, prompt rule, and validator together through the existing pipeline.

- [ ] In `packages/core/src/modules/translation/translation.service.ts`:
  - After validation, check for diacritics warnings
  - If present, set `needsReview: true` (same pattern as other warnings)
  - Log diacritics warnings for debugging
- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts` and `apps/bot/src/scenes/helpers/regen.helper.ts`:
  - No changes needed if the pipeline threads warnings through `TranslateOutput` (from Task 06 or standalone)
  - If `needsReview` is set due to diacritics, the bot already shows ⚠️ — no extra work
- [ ] Verify end-to-end: translate a word from Russian to Czech, confirm the prompt includes the diacritics rule, confirm validation warns on stripped diacritics

**Estimated Effort:** 1–2 hours

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `packages/adapters/db/` | Migration: `hasDiacritics` column + data | Schema change |
| `packages/core/src/modules/i18n/` | `LanguageEntry.hasDiacritics`, helper fn | Read-only field |
| `packages/core/src/modules/translation/` | Prompt diacritics rule | Conditional insertion |
| `packages/core/src/modules/validation/` | New `diacritics.validator.ts` | Pure function, no I/O |
| `apps/bot/` | No changes | Pipeline handles warnings automatically |

---

## Files Modified

- `packages/adapters/db/src/schema.ts` — add `hasDiacritics` column to `languages`
- `packages/adapters/db/src/migrations/` — new migration + data migration
- `packages/adapters/db/src/language-cache.ts` — expose `hasDiacritics`
- `packages/core/src/modules/i18n/language-registry.ts` — add `hasDiacritics` to `LanguageEntry`, add `getLangHasDiacritics()`
- `packages/core/src/modules/translation/prompt.builder.ts` — diacritics rule in prompt
- `packages/core/src/modules/validation/validators/diacritics.validator.ts` — new validator
- `packages/core/src/modules/validation/index.ts` — wire diacritics validator into `validate()`
- `packages/core/src/modules/translation/translation.service.ts` — handle diacritics warnings
- Test files for all above modules

---

## Dependencies

- **Task 06 (token optimization):** If implemented first, the `warnings` field on `ValidationResult` is already available. If not, Step 3 needs to add a lightweight soft-error mechanism or `warnings` field independently.
- **No hard blockers** — each step can land incrementally.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| False positives: valid ASCII loanwords flagged as missing diacritics (e.g., "hotel", "internet" in Czech) | Soft warnings only — don't trigger retries. Wiktionary cross-check can confirm valid loanwords. |
| Prompt injection adds tokens | Diacritics rule is ~60 tokens — negligible vs. total prompt. Only injected when needed. |
| AI still ignores diacritics instruction | Validation catches it post-hoc; `needsReview` flag alerts the user. Retry with strict prompt on actual errors (not just warnings) for future enhancement. |
| `hasDiacritics` is binary but some languages have optional diacritics (French accents vs Czech háčeks) | Start with a single boolean. Can later add a severity level (`required` vs `recommended`) if needed. |
| Wiktionary data doesn't cover all words (compound words, neologisms, slang) | Wiktionary cross-check is optional (Check 3). ASCII-stripping detection (Check 2) works without dictionary. |

---

## Acceptance Criteria

- [ ] `languages` table has `has_diacritics` boolean column
- [ ] All known diacritics-sensitive languages are flagged `has_diacritics = true`
- [ ] `LanguageEntry` in core includes `hasDiacritics` field
- [ ] Translation prompt includes explicit diacritics rule when any target language has `hasDiacritics = true`
- [ ] Diacritics rule is absent from prompt when all targets are non-diacritics languages
- [ ] `diacritics.validator.ts` detects ASCII-stripped translations for diacritics-sensitive languages
- [ ] Diacritics issues produce warnings (not errors) — don't trigger retries
- [ ] `TranslateOutput.needsReview` is set when diacritics warnings are present
- [ ] Existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
- [ ] New tests cover: diacritics flag queries, prompt rule injection, validator (pass/fail/edge cases)
