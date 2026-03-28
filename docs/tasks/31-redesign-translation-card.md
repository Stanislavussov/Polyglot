# Task 31 — Redesign Translation Card: Examples + Register Labels + Connotation Warnings

**Status:** 🔲 To Do  
**Type:** Feature (prompt + renderer + schema + preset)  
**Priority:** High — core UX improvement for the main translation flow  
**Dependencies:** None (all infrastructure exists)

---

## Description

Redesign the translation output card to show **3 register-labeled example sentences per language** (neutral, colloquial, professional) and optional **connotation warnings** for dangerous/misleading meanings. Synonyms move to on-demand only (already rendered, just restructured in the card). The card becomes the primary learning tool — every translation shows real usage across registers.

### Target Output (Telegram)

```
⚡ возбуждать

🇬🇧 to excite (synonym1, synonym2)
💬 The news excited everyone.        → neutral
💬 Stop stirring things up!          → colloquial
💬 The drug stimulates nerve cells.  → professional
⚠️ to arouse — sexual connotation

🇨🇿 vzrušit (synonym1, synonym2)
💬 Zpráva vzrušila veřejnost.        → neutral
💬 Přestaň rozrušovat ostatní!       → colloquial
💬 Výsledky stimulují výzkum.         → professional

──────────────────
[💾 Save] [🔄 EN] [🔄 CS]
```

### Key Changes from Current State

| Aspect | Current | New |
|---|---|---|
| Examples | Disabled in `FULL_OUTPUT` preset (`includeExamples: false`) | Enabled — 3 per language |
| Example format | `formal/colloquial/professional` context + native translation | `neutral/colloquial/professional` — **no native translation**, register label inline |
| Synonyms in card | Rendered as separate block with register | Inline after main translation `(syn1, syn2)` — compact |
| Connotation warnings | Not supported | New optional field — `⚠️` line for dangerous meanings |
| Example native sentence | Included (`native` field) | **Removed** — saves tokens, user sees only target lang |
| Register labels | Not shown on examples | Shown inline: `→ neutral`, `→ colloquial`, `→ professional` |
| CEFR in card | Not shown (disabled) | Stays disabled — no change |

---

## Root Cause

The current `FULL_OUTPUT` preset has `includeExamples: false`, so interactive translations show no example sentences. The example schema requires a `native` translation for each sentence which bloats the prompt and wastes tokens. The renderer shows examples in a verbose format with icons per context type. There is no mechanism for connotation warnings.

---

## Subtasks

### Step 1: Update Example type — drop `native`, rename contexts

**Goal:** Remove the native sentence from examples (token savings) and align context labels with the target card format.

- [ ] In `packages/core/src/modules/translation/types.ts`:
  - Change `ExampleContext` from `"formal" | "colloquial" | "professional"` to `"neutral" | "colloquial" | "professional"`
  - Remove `native: string` from `Example` interface
  - Add `register: string` field to `Example` (the inline register label shown to user, e.g., "нейтральный")
- [ ] In `packages/core/src/modules/translation/schemas/translation.schema.ts`:
  - Update `exampleSchema`: remove `native`, change `context` enum to `"neutral" | "colloquial" | "professional"`, add `register` string field
- [ ] In all tests referencing `Example` / `exampleSchema`: update fixtures to match new shape

> **Migration note:** `formal` → `neutral`. The "formal" label was misleading — these are everyday/neutral examples, not formal-register ones.

### Step 2: Add connotation warning field to `LanguageTranslation`

**Goal:** Support optional `⚠️` warnings for dangerous/misleading connotations.

- [ ] In `packages/core/src/modules/translation/types.ts`:
  - Add `connotationWarning?: string` to `LanguageTranslation` (e.g., `"to arouse — sexual connotation"`)
- [ ] In `packages/core/src/modules/translation/schemas/translation.schema.ts`:
  - Add `connotationWarning: z.string().optional()` to `languageTranslationSchema`
- [ ] In `packages/core/src/modules/translation/types.ts`:
  - Add `includeConnotationWarning?: boolean` to `TranslationOutputConfig` (in `packages/core/src/shared/types.ts` where it actually lives)

### Step 3: Update `FULL_OUTPUT` preset

**Goal:** Enable examples and connotation warnings in the interactive translation preset.

- [ ] In `packages/core/src/shared/translation-output.presets.ts`:
  - `FULL_OUTPUT.includeExamples: true` (was `false`)
  - `FULL_OUTPUT.includeConnotationWarning: true` (new)
- [ ] Verify other presets stay unchanged (`MINIMAL_OUTPUT`, `SENTENCE_OUTPUT`, `NOTIFICATION_OUTPUT`)
- [ ] Add `includeConnotationWarning: false` to `MINIMAL_OUTPUT`, `SENTENCE_OUTPUT` explicitly

### Step 4: Update prompt builder — new example format + connotation

**Goal:** Prompt asks for 3 examples per language (no native sentence), register label in user's interface language, and optional connotation warnings.

- [ ] In `packages/core/src/modules/translation/prompt.builder.ts`:
  - Update example template in `buildTranslationPrompt()`:
    - Remove `"native"` from example JSON template
    - Change `"context": "formal"` to `"context": "neutral"`
    - Add `"register": "<register label in source language, one word>"` to each example
    - Each example must use a **different** word/expression (rule already exists — keep it)
  - Add connotation warning section when `includeConnotationWarning` is enabled:
    ```
    "connotationWarning": "<optional: warn about dangerous/misleading meanings, e.g. 'to arouse — sexual connotation'>"
    ```
  - Add prompt rule: `"Warn about dangerous or misleading connotations ONLY if they exist. Most words should NOT have a warning."`
  - **Token budget:** Remove the native sentence from examples (saves ~30% of example tokens). Keep examples SHORT — one sentence each. Register label is one word only.
  - Update `buildStrictPrompt()` to include the new example/connotation check items

### Step 5: Update renderer — new card layout

**Goal:** Render the new card format with inline synonyms, register-labeled examples, and connotation warnings.

- [ ] In `apps/bot/src/renderers/translation.renderer.ts`:
  - In `renderLangBlock()`:
    - Move synonyms inline after the translation header: `🇬🇧 to excite (syn1, syn2)` — show text only, no register
    - Remove the separate "Synonyms:" block
    - Render examples as: `💬 <i>{sentence}</i>  → {register}` (all use 💬, no per-context icons)
    - Remove native sentence rendering (`→ ${esc(ex.native)}` line)
    - Add connotation warning: `⚠️ {connotationWarning}` after examples (only if present)
    - Keep alternatives rendering as-is (before synonyms line — now before examples)
  - Update `renderTranslation()` if needed (should be minimal — delegates to `renderLangBlock`)

### Step 6: Update i18n keys

- [ ] Remove or deprecate `"synonyms"` and `"examples"` keys if no longer used as section headers
- [ ] Add `"connotationWarning"` key if a localized prefix is needed (or use raw `⚠️` — decide)
- [ ] Verify all 3 locale files (en, ru, cs) are updated

### Step 7: Update validation module

- [ ] In `packages/core/src/modules/validation/`:
  - Update example validation: `native` no longer required, `context` values are `neutral | colloquial | professional`
  - Add `register` field check to example validation
  - `connotationWarning` is optional — no validation needed beyond schema

### Step 8: Write / update tests

- [ ] `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts`:
  - New examples format in prompt (no native, neutral context, register label)
  - Connotation warning section present when enabled
  - Connotation warning absent when disabled
- [ ] `packages/core/src/modules/translation/__tests__/translation.schema.test.ts`:
  - Example schema accepts `neutral | colloquial | professional` (rejects `formal`)
  - Example schema has `register`, no `native`
  - `connotationWarning` optional field on language translation
- [ ] `apps/bot/src/__tests__/translation.renderer.test.ts`:
  - Inline synonyms rendering
  - Register-labeled examples
  - Connotation warning shown when present
  - Connotation warning absent when field is missing
  - No native sentence in output
- [ ] `packages/core/src/modules/translation/__tests__/output-config.test.ts`:
  - `FULL_OUTPUT` now includes examples
  - `FULL_OUTPUT` includes connotation warning

---

## Files Affected

| File | Change |
|---|---|
| `packages/core/src/modules/translation/types.ts` | `ExampleContext` enum change, `Example.native` removed, `Example.register` added, `LanguageTranslation.connotationWarning` added |
| `packages/core/src/shared/types.ts` | `TranslationOutputConfig.includeConnotationWarning` added |
| `packages/core/src/shared/translation-output.presets.ts` | `FULL_OUTPUT.includeExamples: true`, `includeConnotationWarning` on all presets |
| `packages/core/src/modules/translation/schemas/translation.schema.ts` | `exampleSchema` updated, `connotationWarning` added to language schema |
| `packages/core/src/modules/translation/prompt.builder.ts` | Example template rewritten (no native, neutral context, register label), connotation warning section |
| `apps/bot/src/renderers/translation.renderer.ts` | `renderLangBlock()` rewritten — inline synonyms, `💬 → register` examples, `⚠️` warnings |
| `packages/core/src/modules/i18n/locales/en.json` | Possible key changes |
| `packages/core/src/modules/i18n/locales/ru.json` | Possible key changes |
| `packages/core/src/modules/i18n/locales/cs.json` | Possible key changes |
| `packages/core/src/modules/validation/` | Example validation updated |
| Test files (see Step 8) | Updated fixtures and new test cases |

---

## Architecture Constraints

| Package | Scope | Notes |
|---|---|---|
| `packages/core/src/modules/translation/` | Types, schemas, prompt builder | Core changes — Example type, connotation warning, prompt |
| `packages/core/src/shared/` | Output config type + presets | New config field + preset updates |
| `packages/core/src/modules/validation/` | Example validation | Updated for new Example shape |
| `packages/core/src/modules/i18n/` | Locale files | Key updates |
| `apps/bot/src/renderers/` | Card rendering | New layout |
| `apps/bot/src/scenes/helpers/` | No changes | Preset wiring already exists — `FULL_OUTPUT` is used |

---

## Prompt Design Notes

The prompt must be **tight** — no bloat. Key principles:

1. **No native translations in examples** — the user reads in the target language. Saves ~30% example tokens.
2. **Register label is one word** — inline after the sentence, in the user's source language. Not a translation.
3. **Connotation warnings are optional** — the AI should NOT add them to every word. Only for genuinely dangerous/misleading meanings.
4. **3 examples, each different** — rule already exists in current prompt. Keep it. Each example uses a different word (main translation, alternative 1, alternative 2).
5. **Short sentences** — one short sentence each. Not paragraphs.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Word has no dangerous connotations | `connotationWarning` is omitted — no `⚠️` line |
| Word has zero synonyms | No parenthetical after translation: `🇬🇧 to excite` |
| Language has no alternatives | Examples still use the main translation for all 3 |
| `SENTENCE_OUTPUT` / `MINIMAL_OUTPUT` callers | No examples, no connotation warnings — presets unchanged |
| Existing saved words in DB | Old format (`Example` with `native` + `formal` context) — renderer must handle gracefully or migration needed |
| `NOTIFICATION_OUTPUT` already has `includeExamples: true` | Update its example rendering too — same new format (no native) |

---

## Backward Compatibility

⚠️ **Breaking change to `Example` type**: The `native` field is removed and `context` enum values change. This affects:
- Stored word content in DB (if examples were previously saved)
- `NOTIFICATION_OUTPUT` preset (already has examples enabled)
- Any test fixtures with old example format

**Strategy:** The renderer should gracefully handle old example format (ignore `native` if present, map `formal` → `neutral`). Schema validation for *new* AI responses uses the new format only.

---

## Effort Estimate

~5–6 hours

---

## Acceptance Criteria

- [ ] Interactive translation card shows 3 example sentences per language with register labels
- [ ] Examples have NO native (source language) translation — only target language sentence
- [ ] Register label is shown inline after each example: `→ нейтральный`
- [ ] Synonyms are shown inline after translation: `🇬🇧 to excite (syn1, syn2)`
- [ ] Connotation warnings appear as `⚠️` line only when AI flags a dangerous meaning
- [ ] Most translations have NO connotation warning (AI doesn't over-warn)
- [ ] `FULL_OUTPUT` preset has `includeExamples: true` and `includeConnotationWarning: true`
- [ ] `MINIMAL_OUTPUT` and `SENTENCE_OUTPUT` presets are unchanged (no examples)
- [ ] Prompt is concise — no native sentence bloat, short example sentences
- [ ] All example contexts are `neutral | colloquial | professional` (no `formal`)
- [ ] Old example format in DB is handled gracefully by the renderer
- [ ] All new and existing tests pass
- [ ] All packages build: `pnpm -r run build`
