# Requirements: Save to Dictionary (AI Translation → Personal Vocabulary)

**Feature ID:** FEAT-30  
**Date:** 2026-03-28  
**Status:** Draft — awaiting product-owner prioritization  
**References:**
- Research evaluation: `@docs/research/30-save-to-dictionary-evaluation.md`
- Competitor intelligence: `@docs/research/30-save-to-dictionary-competitors.md`
- Input type detection: `@docs/tasks/27-input-type-detection-and-text-limits.md`
- BRD Section: §7.1 — Personal Dictionary (updated in `@docs/BRD.md`)

---

## Overview

The "Save to Dictionary" feature allows a user to persist an AI translation result as a personal vocabulary entry, triggered by a single tap on a Telegram inline button. This document captures the full set of business requirements derived from competitor analysis, research findings, and the stated task requirements.

**Scope:** Word and phrase input types only. Sentence input type is explicitly excluded (already handled by Task 27 which omits the Save button for sentences).

**Current state:** A basic save mechanism exists (`tr:save` callback → `wordRepository.create()`), but it lacks FK integrity, input type tracking, duplicate detection, and content sanitization.

---

## Stakeholder User Stories

### US-3001 — Save a word with one tap
> **As a** language learner using Polyglot,  
> **I want** to save a translated word or phrase to my personal dictionary with a single tap on the Save button,  
> **so that** I can review it later using SRS or browse my vocabulary.

**Acceptance criteria:**
- Tapping the Save button on a word/phrase translation card saves the entry to the `words` table
- The save action requires exactly one tap — no confirmation dialog
- After saving, the message keyboard is replaced with a regen-only keyboard (Save/Skip buttons removed)
- A "✅ Saved!" confirmation is shown in the message

---

### US-3002 — Duplicate prevention
> **As a** language learner,  
> **I want** to be told when a word is already in my dictionary instead of silently creating a duplicate,  
> **so that** my dictionary stays clean and I don't review the same word twice from different entries.

**Acceptance criteria:**
- When the user taps Save on a word that already exists in their dictionary (same `original` + same `sourceLangId`), the system shows an "Already in dictionary" notification (Telegram `answerCallbackQuery` with `show_alert: true`)
- No new entry is created on duplicate save
- The existing `alreadySaved` i18n key (already present in locale files) is used for this notification

---

### US-3003 — Input type preservation
> **As a** language learner,  
> **I want** my dictionary to know whether I saved a word or a phrase,  
> **so that** future quiz features can offer me the right type of question (translate a single word vs fill in a phrase).

**Acceptance criteria:**
- Each saved entry stores whether it was a `word` or `phrase` (never `sentence`)
- `inputType` is stored as a dedicated column in `words` table, not buried in the JSONB blob
- `inputType` is populated from session state (`lastInputType`) at save time
- Default value for existing entries (pre-migration) is `'word'` — acceptable approximation

---

### US-3004 — Contextual Save button labels
> **As a** language learner,  
> **I want** the Save button to say "Save word" or "Save phrase" depending on what I'm translating,  
> **so that** I have clear feedback about what kind of entry is being added to my dictionary.

**Acceptance criteria:**
- For `word` input type: Save button displays "💾 Save word" (new i18n key: `saveWord`)
- For `phrase` input type: Save button displays "💾 Save phrase" (new i18n key: `savePhrase`)
- For `sentence` input type: No Save button is shown (per Task 27, already implemented)
- Skip button remains as-is for both word and phrase

---

### US-3005 — Referential integrity for source language
> **As a** developer maintaining Polyglot's database,  
> **I want** the `words` table to reference the `languages` table via a foreign key for the source language,  
> **so that** there are no orphaned language references and the schema is internally consistent.

**Acceptance criteria:**
- `words` table has a `sourceLangId INTEGER REFERENCES languages(id)` column
- The existing `sourceLang` text column is either removed or deprecated after migration
- All new `wordRepository.create()` calls accept `sourceLangId: number` (resolved from the in-memory language cache at save time)
- If the source language cannot be resolved to a valid `languages.id`, the save fails gracefully with a logged error and user-facing error message

---

### US-3006 — Clean content storage (no internal pipeline data)
> **As a** developer maintaining Polyglot,  
> **I want** the dictionary entries to contain only user-facing learning content,  
> **so that** internal AI pipeline metadata does not pollute user records or cause confusion in future dictionary UI.

**Acceptance criteria:**
- `needsReview` field is stripped from the content JSONB before saving
- `dictionaryContext` (Wiktionary enrichment data) is stripped from the content JSONB before saving
- All other fields from `TranslateOutput` that are user-facing (`emoji`, `register`, `translations[lang].text`, `translations[lang].cefr`, `translations[lang].transcription`, `translations[lang].register`, `translations[lang].synonyms`, `translations[lang].examples`, `translations[lang].alternatives`, `translations[lang].expressionType`, `translations[lang].equivalentNote`) are retained

---

### US-3007 — Post-save regen capability
> **As a** language learner,  
> **I want** to be able to regenerate a specific language's translation even after saving an entry,  
> **so that** I can improve the saved entry if I'm not satisfied with the initial AI output.

**Acceptance criteria:**
- After saving, the message keyboard shows only regen buttons (one per target language), with Save/Skip removed
- Tapping a regen button on a saved entry re-runs the translation for that language and updates the saved entry content (`wordRepository.updateContent()`)
- [needs clarification: should regen after save update the dictionary entry automatically, or prompt user to re-save?]

---

## Functional Requirements

---

### REQ-3001: Save Trigger — Inline Button Only

**Description:** The save to dictionary flow is triggered exclusively by tapping the Telegram inline button (`tr:save` callback data). There is no auto-save, no `/save` command, and no passive save.

**User story:** US-3001

**Acceptance criteria:**
1. The Save button appears on translation cards for `word` and `phrase` input types only
2. For `sentence` input type, no Save button is rendered (existing Task 27 behavior — do not regress)
3. Button tap triggers `handleSaveCallback()` in the bot layer
4. The save flow completes within one callback query response cycle (no multi-step confirmation)

**Business rules:**
- Only the user who owns the translation session can save it (no cross-user saves)
- A word can only be saved from a completed, validated translation (no partial saves during regen)

**Source:** Task requirement #1, competitor analysis §3 (all competitors use one-tap save)

**Priority:** [PO to decide]

**Open questions:** None — existing callback infrastructure is already in place.

---

### REQ-3002: Source Language — Foreign Key to `languages` Table

**Description:** The `words` table must reference the `languages` table via a foreign key for the source language. The current `sourceLang TEXT` column violates the FK requirement and must be migrated.

**User story:** US-3005

**Acceptance criteria:**
1. New column `source_lang_id INTEGER NOT NULL REFERENCES languages(id)` is added to `words` table
2. All existing rows are backfilled: `UPDATE words SET source_lang_id = (SELECT id FROM languages WHERE code = words.source_lang)`
3. A unique constraint is added on `(user_id, original, source_lang_id)` to enforce deduplication at the DB level
4. The save handler resolves `sourceLang` string → `languageId` via `getLang(code)` from the in-memory language cache before inserting
5. If `getLang(code)` returns `null`, the save fails gracefully (log error, show `translationError` to user)
6. The old `source_lang` text column is retained (nullable) during transition, deprecated after validation

**Business rules:**
- Source language is determined at translation time and stored in session (`pendingTranslation.sourceLang`)
- Source language is always a supported language (seeded during app initialization)

**Source:** Task requirement #6, research evaluation §Hypothesis B, competitor analysis §3.7 (DeepL language pair integrity)

**Priority:** [PO to decide]

**Open questions:**
- C1 [needs clarification]: Is a breaking schema migration acceptable for the `words` table? Risk: any existing `sourceLang` values not present in the `languages` table will fail backfill. Mitigation: add nullable FK first, backfill with NULL for unknowns, then make NOT NULL after verification.
- What is the rollback plan if the migration fails in production?

---

### REQ-3003: Input Type — Dedicated Column in `words` Table

**Description:** Each dictionary entry must store the input type (`word` or `phrase`) that was used to create it. This enables future SRS differentiation (word quiz vs phrase gap-fill), analytics, and filtering.

**User story:** US-3003

**Acceptance criteria:**
1. New column `input_type TEXT CHECK (input_type IN ('word', 'phrase')) DEFAULT 'word'` added to `words` table
2. At save time, `inputType` is read from `ctx.session.lastInputType` (set by the input classifier per Task 27)
3. Only `'word'` and `'phrase'` values are accepted — `'sentence'` is never passed (sentences have no Save button)
4. Existing entries (pre-migration) default to `'word'` — this is an acceptable approximation
5. `wordRepository.create()` accepts and stores `inputType`

**Business rules:**
- `inputType` reflects the classification made by `classifyInput()` at translation time, not at save time (the input classifier already ran before the Save button was rendered)
- `inputType` is immutable after save (no update path needed)

**Source:** Task requirement #2/#8, research evaluation §Hypothesis E and C

**Priority:** [PO to decide]

**Open questions:**
- C6 [needs clarification]: Is defaulting all pre-existing entries to `'word'` acceptable, or should we attempt post-hoc classification of existing entries using word count?

---

### REQ-3004: Duplicate Detection — Prevent Double Saves

**Description:** Before saving a word, the system must check whether the user already has an entry with the same `original` text and `sourceLangId`. If a duplicate is detected, the user is informed and no new entry is created.

**User story:** US-3002

**Acceptance criteria:**
1. New repository method: `wordRepository.findByOriginalAndSource(userId: number, original: string, sourceLangId: number): Promise<Word | null>`
2. In `handleSaveCallback()`, before inserting, call `findByOriginalAndSource()` to check for duplicates
3. If duplicate found: call `ctx.answerCallbackQuery({ text: t('alreadySaved', lang), show_alert: true })` and return without creating a new entry
4. If no duplicate: proceed with save and show "✅ Saved!" confirmation
5. Unique constraint on `(user_id, original, source_lang_id)` in the DB acts as a safety net for race conditions
6. The existing `alreadySaved` i18n key is used (already present in `en.json`, `ru.json`, `cs.json`)

**Business rules:**
- Duplicate check is by `(userId, original, sourceLangId)` — same user, same original text, same source language
- Target languages are NOT part of the duplicate key — a word saved with CS+EN targets is a duplicate of the same word saved with DE targets
- Duplicate detection does NOT update the existing entry (Option A: read-only dedup, not Option B: update-on-duplicate) — [needs clarification: C3 — is Reverso-style read-only dedup the correct behavior, or should duplicates silently update?]

**Source:** Task requirement (implied), research evaluation §Hypothesis F, competitor analysis §3.1 (Reverso "In Vocabulary" pattern), §3.6 (Telegram bots)

**Priority:** [PO to decide]

**Open questions:**
- C3 [needs clarification]: When a duplicate is detected, should the system (A) show "Already saved" and stop, or (B) silently update the existing entry with the latest translation content? The research recommendation is Option A (Reverso-style). This is a product decision.
- Should duplicate detection also check case-insensitively? (e.g., "Doctor" vs "doctor")

---

### REQ-3005: Content Sanitization Before Save

**Description:** Before writing to the `words` table, the save handler must strip internal pipeline fields from the `TranslateOutput` object that are not user-facing learning content.

**User story:** US-3006

**Acceptance criteria:**
1. `needsReview` field is removed from the content before calling `wordRepository.create()`
2. `dictionaryContext` field is removed from the content before calling `wordRepository.create()`
3. All other fields are preserved: `emoji`, `register`, `translations` (with full nested structure including `text`, `cefr`, `transcription`, `register`, `synonyms`, `examples`, `alternatives`, `expressionType`, `equivalentNote`)
4. The `original` field is NOT duplicated in JSONB (it is already stored as the `words.original` dedicated column)

**Business rules:**
- `needsReview` is a transient validation signal valid only at translation time — storing it creates a permanently stale flag
- `dictionaryContext` is internal Wiktionary enrichment data injected into the AI prompt — it is never shown to users and wastes storage (~100–400 bytes per entry)

**Stored content type:**
```typescript
interface StoredWordContent {
  emoji: string;
  register: Register;
  translations: Record<string, {
    text: string;
    cefr: CefrLevel;
    transcription?: string;
    register: Register;
    synonyms: Synonym[];
    examples: Example[];
    alternatives?: TranslationVariant[];
    expressionType?: ExpressionType;
    equivalentNote?: string;
  }>;
}
```

**Source:** Research evaluation §Hypothesis A (verdict: sanitize), §Hypothesis C

**Priority:** [PO to decide]

**Open questions:** None — clear technical requirement with no product ambiguity.

---

### REQ-3006: Bot Rendering — Different Save Button Labels for Word vs Phrase

**Description:** The Save button label must reflect the input type being saved to give users clear, contextual feedback.

**User story:** US-3004

**Acceptance criteria:**
1. For `word` input type: Save button text is `"💾 Save word"` using i18n key `saveWord`
2. For `phrase` input type: Save button text is `"💾 Save phrase"` using i18n key `savePhrase`
3. Both `saveWord` and `savePhrase` i18n keys are added to `en.json`, `ru.json`, `cs.json`
4. The existing generic `saveToDictionary` i18n key is deprecated or repurposed for other contexts
5. The Skip button label remains unchanged for both word and phrase
6. No changes to sentence rendering (Regen-only keyboard, per Task 27)

**Business rules:**
- Button label change requires no backend changes — only i18n and keyboard builder updates
- The label change applies to both initial translation display and post-regen keyboard rebuild

**Source:** Task requirement #8, competitor analysis §5.2 (Duolingo-style contextual button labels), research evaluation §Hypothesis G

**Priority:** [PO to decide]

**Open questions:**
- C4 [needs clarification]: Beyond the button label change, should word and phrase cards have distinctly different visual layouts? Research verdict: start with button label only (minimal); add section reordering (examples first for phrases) in v2. Is this the product decision?

---

### REQ-3007: Post-Save Keyboard — Regen-Only After Save

**Description:** After a word or phrase is saved, the Save/Skip buttons are removed from the keyboard. Only regen buttons remain, allowing the user to refine translations without re-triggering the save flow.

**User story:** US-3007

**Acceptance criteria:**
1. Immediately after a successful save, the translation message keyboard is replaced with a regen-only keyboard (same format as the sentence keyboard from Task 27, but with the word/phrase context)
2. Each regen button corresponds to one target language (`🔄 CS`, `🔄 EN`, etc.)
3. Tapping a regen button after save re-runs translation for that language and calls `wordRepository.updateContent()` on the existing saved entry
4. The confirmation indicator ("✅ Saved!") remains visible in the message after save (not removed by regen)

**Business rules:**
- The regen buttons on a saved card use the same `tr:regen:<lang>` callback data as before save
- The regen handler must detect whether the word is already saved (via `pendingTranslation` session state or a DB lookup) and use `updateContent` instead of creating a new entry
- [needs clarification: C5 — when regen fires after save, does it auto-update the saved entry, or remove the "Saved" indicator and require re-save?]

**Source:** Research evaluation §Hypothesis G (Alt G4), task requirement #4 (reconsider current rendering concept)

**Priority:** [PO to decide]

**Open questions:**
- C5 [needs clarification]: What is the expected behavior when a user regens a language after saving? Three options: (A) auto-update the saved entry silently, (B) revert to "unsaved" state requiring re-save, (C) show "Update saved entry?" prompt. Recommendation: Option A (silent update via `updateContent`), but this is a product decision.

---

### REQ-3008: Database Schema — Migration `0005_words_dictionary_improvements`

**Description:** A new database migration must be written to add the required columns and constraints to the `words` table.

**User story:** US-3005 (technical enabler)

**Acceptance criteria:**
1. Migration adds `source_lang_id INTEGER REFERENCES languages(id)` (nullable first)
2. Migration backfills `source_lang_id` from existing `source_lang` text via `JOIN languages ON code = source_lang`
3. Migration makes `source_lang_id NOT NULL` after backfill
4. Migration adds `input_type TEXT CHECK (input_type IN ('word', 'phrase')) DEFAULT 'word'`
5. Migration adds unique constraint: `UNIQUE (user_id, original, source_lang_id)` 
6. Migration is idempotent and reversible (has a `down` migration)
7. The old `source_lang` text column is NOT dropped in this migration — kept for backward compatibility, dropped in a subsequent migration after production validation

**Business rules:**
- Migration must not break existing saved word entries
- Any existing `source_lang` value that cannot be matched to `languages.code` should be handled gracefully (log warning, set `source_lang_id = NULL` temporarily, flag for review)

**Source:** Task requirement #6, research evaluation §Final Verdict (DB Migration section)

**Priority:** [PO to decide]

**Open questions:**
- What happens to existing words if their `source_lang` value doesn't exist in `languages.code`? Estimated risk: low (all supported languages are seeded at startup), but needs explicit handling.

---

### REQ-3009: Repository — `findByOriginalAndSource` Method

**Description:** The `wordRepository` must expose a method to check for an existing entry by the combination of user, original text, and source language ID. This is required for duplicate detection (REQ-3004).

**User story:** US-3002 (technical enabler)

**Acceptance criteria:**
1. New method: `findByOriginalAndSource(userId: number, original: string, sourceLangId: number): Promise<Word | null>`
2. Returns the existing `Word` entity if found (including its `id` for potential update), or `null` if not found
3. Method uses `WHERE user_id = $1 AND original = $2 AND source_lang_id = $3` with `LIMIT 1`
4. Method is covered by unit tests (at minimum: found case, not-found case)

**Business rules:**
- Case sensitivity: the query uses exact match on `original`. Normalization (trim/lowercase) is applied before passing to this method — see REQ-3010.

**Source:** Research evaluation §Hypothesis F, competitor analysis §6

**Priority:** [PO to decide]

**Open questions:** None.

---

### REQ-3010: Input Normalization Before Save and Lookup

**Description:** The `original` text must be normalized (trimmed, lowercased) before saving and before the duplicate lookup, to prevent near-duplicates like "Doctor" and "doctor" creating separate entries.

**User story:** US-3002 (supplement)

**Acceptance criteria:**
1. `original` value is trimmed of leading/trailing whitespace before save and before duplicate lookup
2. [needs clarification: should `original` be stored lowercased, or preserve original casing? Preserving case is better for display; lowercased for lookup could be done via a separate `normalizedOriginal` column or `LOWER()` in the DB query]
3. At minimum: whitespace trim is applied

**Business rules:**
- The `original` field is user-facing (shown in cards, notifications) — case preservation matters for proper nouns like "Hippocratic Oath"
- Duplicate detection should be case-insensitive [needs clarification]

**Source:** Derived from REQ-3004 implementation detail

**Priority:** [PO to decide]

**Open questions:**
- Should duplicate detection use `LOWER(original) = LOWER($2)` to catch case variants? Or exact match?

---

## Non-Functional Requirements

### NFR-2801: Performance — Save Latency
- The save operation (including duplicate check) must complete within 500ms under normal load
- The duplicate check (`findByOriginalAndSource`) benefits from the unique index on `(user_id, original, source_lang_id)` — query will use the index

### NFR-2802: Data Integrity
- The unique constraint on `(user_id, original, source_lang_id)` prevents duplicate entries even under race conditions (two simultaneous taps)
- The FK constraint `source_lang_id REFERENCES languages(id)` prevents orphaned language references

### NFR-2803: Backward Compatibility
- All changes to `wordRepository.create()` must maintain backward compatibility for any existing callers (topic-save flow, notification save flow)
- New fields (`sourceLangId`, `inputType`) should have defaults in the repository signature to avoid breaking call sites not yet updated

---

## Open Questions Summary

The following items require clarification from the product owner or architect before implementation:

| ID | Area | Question | Recommendation |
|---|---|---|---|
| C1 | DB Migration | Is a breaking migration for `sourceLang → sourceLangId` acceptable? | Yes, with nullable FK first + backfill strategy |
| C2 | Target Lang FK | Add `word_target_langs` junction table (Option A) or validate JSONB keys at write time (Option B)? | Option B for now; Option A in v2 |
| C3 | Duplicate Behavior | On duplicate: (A) show "Already saved" / stop, or (B) silently update content? | A (Reverso-style) — but product must confirm |
| C4 | Phrase Rendering | Beyond button label, should phrase cards have distinctly different layout (examples first)? | Minimal now (label only); full in v2 |
| C5 | Post-Save Regen | When regen fires on a saved card: auto-update entry (A), revert to unsaved (B), or prompt (C)? | A (auto-update via updateContent) |
| C6 | Existing Data | Defaulting pre-existing entries to `inputType = 'word'` — acceptable approximation? | Yes |

---

## What Is Already Implemented (Do Not Re-Implement)

| Feature | Implemented By | Notes |
|---|---|---|
| `tr:save` inline button on translation card | Existing codebase | In `buildTranslationKeyboard()` |
| `handleSaveCallback()` save flow | Existing codebase | In `translate-mode.helper.ts` |
| Full `TranslateOutput` stored as JSONB | Existing codebase | `words.content` field |
| Save disabled for sentence input | Task 27 | No `pendingTranslation` for sentences |
| Confirmation message after save | Existing codebase | Card edited in-place |
| `wordRepository.create/findByUser/findById/search` | Existing codebase | CRUD in DB layer |
| Soft delete (`isActive = false`) | Existing codebase | `wordRepository.delete()` |
| `lastInputType` in session | Task 27 | Available for use at save time |
| `alreadySaved` i18n key | Existing codebase | Present but unused in locale files |
| `sentenceTranslation` label + Regen-only keyboard for sentences | Task 27 | Do not regress |

---

## Competitor Benchmarks Cross-Reference

| Requirement | Competitor Evidence |
|---|---|
| One-tap save button | Reverso Context, @DailyEnglishBot, @LearnEnglishBot — all use single-tap inline save |
| "Already saved" dedup state | Reverso Context — "In Vocabulary" button state prevents double-save |
| Language FK integrity | DeepL — stores `source_lang` + `target_lang` as structured fields, not blobs |
| Input type tracking | No competitor tracks this — Polyglot would be first; enables SRS type differentiation |
| Content sanitization (strip internal data) | Anki — JSONB blob model proven at scale; recommendation is to keep flexible content but exclude ephemeral fields |
| Post-save regen | No competitor implements this; Polyglot's multi-language regen is a unique capability |
| Contextual button labels | Duolingo-style contextual specificity (though for lessons, not save) |

---

## Out of Scope for This Feature

The following are explicitly **not** part of this requirements document:

| Feature | Why Out of Scope |
|---|---|
| `/dictionary` browse command | Post-save loop is a separate feature; saving without browsing is a valid MVP step |
| SRS scheduling on save | Depends on SRS subsystem (Post-MVP 2.3) |
| Save to specific topic/collection | Post-MVP 2.2 (Quizlet-style sets) |
| Edit saved translation | BRD §7.1 "Edit translation" — separate feature |
| Per-language Save buttons | Rejected — conflicts with multi-language USP (see research §Hypothesis G, Alt G3) |
| `word_target_langs` junction table | C2 clarification needed; defer to v2 per research recommendation |
| Auto-save (without button tap) | Rejected — removes user agency; inline button is the correct UX for Telegram |
| Sentence save to dictionary | Explicitly excluded per task requirement #7 |
