# Research Evaluation: AI Translation → Personal Dictionary Storage

**Date:** 2026-03-28  
**Task:** How to store AI translation output as user dictionary entries (triggered by Telegram inline button)  
**Scope:** word and phrase input types only (sentence excluded per requirements)

---

## Context Snapshot (Current State)

Before evaluating anything, here is where the codebase stands today:

| Layer | Current State |
|---|---|
| `words` table | `userId`, `original`, `sourceLang` (plain **text**), `content` (JSONB), `isActive`, timestamps |
| Save trigger | `tr:save` inline button → `handleSaveCallback()` → `wordRepository.create()` |
| Stored content | Entire `TranslateOutput` object (incl. `needsReview`, `dictionaryContext`) |
| Input type routing | Task 27 complete: word/phrase → full card + Save/Skip/Regen; sentence → compact + Regen only |
| Duplicate detection | None — user can save the same word multiple times |
| Language FKs | `sourceLang` is text string; `translationRequests.sourceLangId` is FK to `languages.id` |

---

## Hypothesis A — Storing Full TranslateOutput JSONB Blob Is the Right Approach

### Evidence For

- **Already in production and working.** The entire `TranslateOutput` is stored, and `wordRepository.updateContent()` already handles partial-regeneration merges (user regens one language, the new translation is merged into the existing content blob).
- **Flexible schema evolution.** Adding new fields to `LanguageTranslation` (e.g., `idiomAnalysis`) doesn't require a migration — just lands in the blob.
- **Avoids join complexity.** Fetching a word entry returns everything in one row. No `JOIN` needed for dictionary browsing, SRS review cards, or notifications.
- **Consistent with `topicTranslationCache`** which also uses `content (jsonb)` for the same kind of multi-language translation data.

### Evidence Against

- **Ephemeral fields are stored permanently.** `needsReview: true/false` is a signal from the validation pipeline — it's a momentary quality flag, not a permanent characteristic of the word. Persisting it creates a stale/misleading "this needs review" flag on a word saved weeks ago.
- **Internal enrichment data is persisted.** `dictionaryContext` (raw Wiktionary data injected into the AI prompt) is an internal implementation detail. It is never rendered to the user in the dictionary view. Storing it wastes space (~100–400 bytes per entry) and exposes internal pipeline data in user-facing records.
- **`inputType` is not stored.** This is needed for SRS direction (quiz: native→target or target→native), filtering (show only single words vs phrases), and future quiz generation (words need different quiz types than phrases).
- **No FK integrity on `sourceLang`.** The field is a text string, inconsistent with `translationRequests.sourceLangId` which is already a FK to `languages.id`. This means orphan entries, no referential integrity, and prevents join queries.

### Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `needsReview: true` shown in future dictionary UI | Medium | Low | Strip flag before storing |
| `dictionaryContext` leaking to future dictionary export features | Low | Medium | Never store internal pipeline data in user records |
| Schema evolution breaks JSONB readers | Low | High | Define stable content interface in types; strip unknown fields before write |

### Alternatives

**Alt A1: Normalized `word_translations` table** — separate table with FK to `languages.id` per translation.  
- Pro: Full FK integrity, queryable by language, sortable by CEFR  
- Con: 3–4 JOIN per dictionary fetch, schema migration for existing data, no benefit at current scale (<100K users)  
- **Verdict: Premature at this stage. Revisit at 500K+ words stored.**

**Alt A2: Keep JSONB but sanitize content before write** — strip `needsReview` and `dictionaryContext` from the stored blob.  
- Pro: Zero migration, keeps flexibility, cleans up user records  
- Con: Slight overhead in save handler  
- **Verdict: Do this now.**

### Verdict on Hypothesis A ✅ Recommend with Refinement

Keep the JSONB content approach. It is correct for the current scale and complexity. **However, sanitize the content before writing**: strip `needsReview` and `dictionaryContext` from the stored payload. The content blob should contain exactly what a user needs to see and review — nothing from the internal pipeline.

---

## Hypothesis B — `sourceLang` Should Be a FK to `languages.id`

### Evidence For

- **Consistency.** `translationRequests.sourceLangId` is already a FK to `languages.id` (added in migration `0004`). Having `words.sourceLang` as plain text creates an inconsistency in the same schema.
- **Integrity.** A word entry should not reference a language code that no longer exists. FK prevents orphaned references.
- **Requirement #6** explicitly states: "Always use related table values (foreign keys to existing tables)."
- **Future queries.** Filtering dictionary by source language, joining with language metadata (flag, name) — all require a FK or an extra lookup. With FK, it's a natural join.

### Evidence Against

- **Migration required.** Existing `words` rows have `source_lang: text`. Migrating requires a JOIN update: `UPDATE words SET source_lang_id = l.id FROM languages l WHERE l.code = words.source_lang`. The old `source_lang` column can be retained temporarily for backward compatibility.
- **More complex insert.** The save handler must resolve `sourceLang` string → `languageId` via `languageRepository.findByCode()` (or the in-memory language cache) before inserting.
- **Language cache already exists.** The `language-cache.ts` module provides `getLang(code)` returning `Language | null` — so the FK lookup is essentially free (no extra DB roundtrip).

### Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Migration fails for unknown language codes | Low | Medium | Add NULL FK with fallback; log unknown codes |
| Auto-detected language not yet in `languages` table | Low | High | `getOrCreate` ensures all supported langs are in table at startup |

### Verdict on Hypothesis B ✅ Recommend

The `words` table must be migrated to use `source_lang_id INTEGER REFERENCES languages(id)`. The `sourceLang` text column should be kept as-is during migration for backward compat, then deprecated after the migration confirms all rows have a valid FK. The in-memory language cache makes this zero-overhead at runtime.

**Action required:** New migration `0005_words_source_lang_fk.sql`.

---

## Hypothesis C — What Content Fields Make Sense to Store

The AI translation pipeline produces a rich `TranslateOutput` object. Not all fields belong in a persistent dictionary entry.

### Field-by-Field Analysis

| Field | Store? | Rationale |
|---|---|---|
| `original` | ✅ Yes | The headword — essential for lookup and display |
| `sourceLang` / `sourceLangId` | ✅ Yes (FK) | Defines the word's origin language |
| `emoji` | ✅ Yes | Visual identity — shown on cards, notifications, quiz |
| `register` | ✅ Yes | Top-level formality of the word — displayed on cards |
| `translations[lang].text` | ✅ Yes | Core translation in each target language |
| `translations[lang].cefr` | ✅ Yes | Proficiency level — used in SRS, notifications, display |
| `translations[lang].transcription` | ✅ Yes | Pronunciation aid — valuable for non-Latin scripts |
| `translations[lang].register` | ✅ Yes | Per-language register — shown on cards |
| `translations[lang].synonyms` | ✅ Yes | Alternatives for display and future quiz generation |
| `translations[lang].examples` | ✅ Yes | Most valuable for retention; context sentences |
| `translations[lang].alternatives` | ✅ Yes | 1–2 translation variants — useful for quiz false-answer pool |
| `translations[lang].expressionType` | ✅ Yes | word vs idiomatic equivalent — relevant for rendering |
| `translations[lang].equivalentNote` | ✅ Yes | Explanation of why idiom equivalent was chosen |
| `needsReview` | ❌ No | Ephemeral validation flag — stale after save |
| `dictionaryContext` | ❌ No | Internal Wiktionary enrichment data — never user-facing |
| `inputType` | ✅ Store as column | 'word' \| 'phrase' — needed for SRS direction and quiz type selection |

### Recommended Stored Structure

```typescript
// words.content JSONB — stripped of internal fields
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

### Verdict on Hypothesis C ✅ Recommend

Store all learning-relevant fields. Strip `needsReview` and `dictionaryContext` before write. Add `inputType` as a dedicated column (not buried in JSONB) so it can be used as a query filter.

---

## Hypothesis D — Competitor Dictionary Approaches (Best Practice Benchmark)

### Analyzed Products

| Product | Save Trigger | What Is Stored | Duplicate Handling | Input Type Differentiation |
|---|---|---|---|---|
| **Reverso Context** | Inline "⭐ Add to vocabulary" | Word + translation pair + context sentence | Silent deduplicate (same word = update, not duplicate) | Phrases treated same as words |
| **Anki** | Manual card creation | Front + Back (free-form) + optional media | Duplicate check on deck import | No input type concept |
| **Duolingo** | Auto-saved from lessons | Word + hint translation + course context | No duplicates (curriculum-based) | Fixed lesson words only |
| **Lexicorn (Telegram)** | `/save` or inline button | Word + translation + examples | No dedup (allows duplicates) | No differentiation |
| **MemoWords AI** | Inline save button | Word + AI translation + Anki export | Warns on duplicate | No differentiation |
| **Google Translate Phrasebook** | Star button | Text + translation pair | Silent dedup (overwrite) | No differentiation |

### Key Insights from Competitor Analysis

1. **One-tap inline button is industry standard** — Reverso, Lexicorn, MemoWords all use it. ✅ Polyglot already has this.
2. **Duplicate detection is expected** — of 6 competitors, 4 handle duplicates (silent update or warning). Polyglot has no dedup at all — this will frustrate users who accidentally tap Save twice.
3. **Silent dedup (update, not reject) is the best UX** — Reverso silently updates the entry; no error messages. Better than blocking the user with "already saved".
4. **Examples are the most valued field** — Reverso Context's entire value proposition is the example sentences. Users expect them in the dictionary.
5. **CEFR differentiation is rare** — Polyglot's CEFR display is a genuine differentiator vs all competitors except academic products.
6. **No competitor differentiates word vs phrase in storage** — Polyglot would be first to store `inputType` metadata. This enables quiz type selection later (word: guess translation; phrase: fill-in-the-blank).
7. **Post-save editing is expected** — BRD Section 2.1 mentions it. No competitor blocks editing.

### Best Practice Distilled

From the competitive landscape, the ideal dictionary save flow:
1. User taps "➕ Save" inline button (already implemented)
2. System checks for duplicate (userId + original + sourceLangId) — **missing**
3. If duplicate: show "ℹ️ Already in your dictionary" toast and update content silently — **missing**
4. If new: save with sanitized content, show "✅ Saved!" confirmation — ✅ implemented
5. Card message is updated (keyboard removed, confirmation appended) — ✅ implemented

### Verdict on Hypothesis D

The current save trigger mechanism (inline button, single tap, message edit on confirm) is best-in-class and matches industry standards. The critical missing feature vs competitors is **duplicate detection**. Add a uniqueness constraint on `(userId, original, sourceLangId)` with upsert-on-conflict behavior.

---

## Hypothesis E — Input Type Differentiation in Bot UI Is Already Correct

### Evidence For

- Task 27 is fully implemented: word/phrase uses `buildTranslationKeyboard` (Save + Skip + Regen), sentence uses `buildSentenceKeyboard` (Regen only).
- The keyboard already hides Save for sentence input — aligned with requirement #7.
- Rendering is differentiated: full card (CEFR, synonyms, examples) for word/phrase; compact card for sentence.

### Evidence Against

- The `saveToDict` i18n key ("💾 Save to dictionary?") exists in the locale but is **not displayed anywhere** in the current UI. The button text is `saveToDictionary: "➕ Save to dictionary"`. This is fine — the label is redundant.
- **Phrase vs word rendering is identical** — the BRD says "word or phrase" and requirement #8 says "different rendering/buttons for word vs phrase vs sentence". Currently word and phrase get identical rendering. Is this intentional?

### Word vs Phrase: Should They Render Differently?

**Analysis:**
- A `word` (≤2 tokens): typically has a single primary translation. CEFR, synonyms, transcription are all highly relevant.
- A `phrase` (3–6 tokens): may have a primary translation + idiomatic notes. Examples are still relevant. CEFR less precise (phrase difficulty is holistic). Synonyms less applicable (synonym of a 4-word phrase is unusual).

**Competitor precedent:** No competitor differentiates word vs phrase rendering in their inline bots. Reverso shows the same format. The distinction matters more for quiz type (word → translate single term; phrase → context gap-fill) than for display.

**Recommendation:** Keep word and phrase rendering identical for now. The `inputType` stored as column enables differentiated UX in v2 (SRS, quiz). The current identical rendering is pragmatically correct — adding visual differentiation before it provides user value is over-engineering.

### Verdict on Hypothesis E ✅ Already Correct

The word/phrase/sentence routing is implemented correctly by Task 27. No rendering changes needed for this feature. The only gap is that `inputType` is not persisted to the `words` table — which limits future SRS and quiz features.

---

## Hypothesis F — Duplicate Detection Is Needed

### Current State

No uniqueness constraint on `words` table. `wordRepository.create()` always inserts, never upserts. Users can (and will) accidentally save the same word multiple times.

### Evidence For Adding Dedup

- All major competitors handle duplicates
- The `alreadySaved: "ℹ️ This word is already in your dictionary."` i18n key **already exists** in `en.json` — this was planned but never implemented
- Without dedup, the dictionary becomes polluted with duplicate entries, breaking SRS (same word reviewed twice from different records)

### Evidence Against

- Adding a unique constraint risks migration conflicts if test data has duplicates
- Upsert logic slightly increases code complexity

### Recommended Approach: Check + Upsert

```typescript
// In wordRepository
async upsert(userId, word): Promise<{ created: boolean; entry: Word }> {
  // Try insert; on conflict (userId, original, sourceLangId) — update content
}
```

Or simpler: **check before insert** in the save handler:
1. `wordRepository.findByOriginalAndUser(userId, original, sourceLangId)`
2. If exists → answer callback with `alreadySaved` toast
3. If not → create and answer with `savedToDict`

The `alreadySaved` i18n key already exists. The unique constraint prevents ghost duplicates even if the handler logic has a race condition.

### Verdict on Hypothesis F ✅ Implement Dedup

Add unique constraint on `(user_id, original, source_lang_id)` in migration. Add `findByOriginalAndSource` method to `wordRepository`. In the save handler: check first, show `alreadySaved` toast if found (without editing the message), otherwise save and confirm.

---

## Hypothesis G — Card Rendering Should Be Reconsidered for Save Feature

Requirement #4 says "the whole current concept of rendering results in the bot can be reconsidered to support this feature". Let me evaluate what reconsidering would buy us.

### Current Rendering Flow

```
Translation message:
  🏥 Hippocratic Oath
  Register: professional
  
  🇨🇿 CS: Hippokratova přísaha [ˌhɪp...]
     ∙ variant (register)
  CEFR: C1 · professional
  Synonyms: lékařský slib (professional)
  Examples:
    📎 formal example
    → native translation
  
[🔄 CS] [🔄 EN]
[➕ Save to dictionary] [❌ No]
```

After save:
```
  (same card text)
  
  ✅ Saved to dictionary!
```
(keyboard removed)

### Alternative Rendering Approaches

**Alt G1: Collapsed card + expand button**  
Show compact view (emoji + word + main translation per language) by default. "▶ Show details" button expands full card in-place.  
- Pro: Less visual clutter for familiar words  
- Con: Extra tap, higher complexity, likely worse for first encounter with a new word  
- **Verdict: Skip for MVP, consider for dictionary browse view**

**Alt G2: Split save confirmation into separate message**  
Instead of editing the translation card to add "✅ Saved!", send a new message: "✅ [word] saved to dictionary."  
- Pro: Preserves the original clean card for screenshot/reference  
- Con: Extra message in chat, noisier  
- **Verdict: Skip. The current edit-in-place is cleaner.**

**Alt G3: "Save per language" instead of "Save all"**  
Show one save button per target language: "[➕ Save CS]" "[➕ Save EN]"  
- Pro: User may only care about one target language  
- Con: More buttons, more complexity, loses the multi-language USP (Polyglot's core value is saving across ALL learning languages simultaneously)  
- **Verdict: Reject. Conflicts with Polyglot's core multi-language value prop.**

**Alt G4: Persistent "Saved" badge in message (no keyboard removal)**  
After save, keep the regen buttons but replace Save/Skip row with "✅ Saved" static badge.  
- Pro: User can still regen individual language after saving  
- Con: Saved card is harder to distinguish from unsaved; minor UX improvement  
- **Verdict: Could be done as UX polish in v2, not blocking for feature delivery.**

**Alt G5: Word/phrase show different button labels**  
- Word: "➕ Save word" 
- Phrase: "➕ Save phrase"  
- Pro: Slightly more precise labeling  
- Con: Negligible UX value; adds i18n complexity; not needed  
- **Verdict: Skip.**

### Assessment of Current Approach

The current rendering is **already best-in-class for a Telegram bot**. The inline keyboard with Save/Skip/Regen, card editing on confirm, and the full rich card layout match what Reverso and Lexicorn do (or exceed them, with CEFR and synonyms). There is no compelling reason to reconsider the fundamental rendering concept for this feature.

The one improvement worth making: after Save, **replace the keyboard with a "regen-only" keyboard** (remove Save/Skip, keep Regen buttons). Currently, Save removes the entire keyboard. This allows users to re-generate a specific language translation even after saving, then the content update path (`wordRepository.updateContent`) would update the saved entry.

### Verdict on Hypothesis G ✅ Keep Current, Minor Polish

The current rendering concept is correct. No fundamental reconsidering needed. Minor improvement: after saving, show regen-only keyboard (instead of removing all buttons) so users can refine specific language translations.

---

## Summary: Identified Gaps and Gaps Already Covered

### ✅ Already Implemented (by Task 27 and existing code)
- Save triggered by inline button (`tr:save`)
- Save only for word/phrase; sentence has no Save button
- Different rendering per input type (word/phrase vs sentence)
- Visual confirmation on save ("✅ Saved to dictionary!")
- i18n key for "already saved" scenario (exists, unused)
- Rich content stored (text, CEFR, synonyms, examples, transcription)

### ❌ Gaps That Must Be Addressed

| Gap | Priority | Solution |
|---|---|---|
| `words.sourceLang` is text, not FK to `languages.id` | HIGH | Migration `0005`: add `source_lang_id INTEGER REFERENCES languages(id)`, backfill, FK constraint |
| `inputType` not stored in `words` table | HIGH | Add `input_type TEXT CHECK (input_type IN ('word', 'phrase'))` column to `words` table |
| No duplicate detection | HIGH | Unique constraint on `(user_id, original, source_lang_id)` + check before insert |
| `needsReview` and `dictionaryContext` stored in content | MEDIUM | Sanitize content before write in save handler |
| After-save keyboard keeps no Regen buttons | LOW | Post-save, replace keyboard with regen-only buttons (optional UX polish) |

### Clarification Requests

The following points in the requirements are ambiguous:

1. **Requirement #8**: "different rendering/buttons for word vs phrase vs sentence" — the current code already renders word and phrase identically (both get the full card + Save/Skip/Regen keyboard). Should word and phrase have **distinctly different** rendering, or is this referring to the existing word/phrase vs sentence differentiation? **Current interpretation: word and phrase are rendered identically; sentence is rendered differently. This is correct.**

2. **Source language FK**: When the source language was auto-detected (not explicitly set by user), it is determined by `resolveTranslationDirection()`. This language code must be resolved to `languageId` via the in-memory language cache at save time. What should happen if the detected source language is not in the `languages` table? **Assumption: auto-detected language is always in the table (seeded during onboarding). If not found, save should fail gracefully with a log entry.**

3. **Content JSONB vs additional columns**: Should any of the top-level content fields (e.g., `emoji`, `register`) be promoted to dedicated columns for query performance? **Verdict: No. These are display/enrichment fields. Only `inputType` and `sourceLangId` need dedicated columns.**

---

## Final Verdict and Recommended Implementation Plan

### Architecture Decision: Minimal Surgery on Existing Schema

The current save flow is largely correct. The changes are evolutionary, not revolutionary:

#### DB Migration (`0005_words_dictionary_improvements.sql`)
```sql
-- 1. Add source_lang_id FK column (nullable initially for migration safety)
ALTER TABLE words ADD COLUMN source_lang_id INTEGER REFERENCES languages(id);

-- 2. Backfill from existing sourceLang text values
UPDATE words w 
SET source_lang_id = l.id 
FROM languages l 
WHERE l.code = w.source_lang;

-- 3. Add inputType column
ALTER TABLE words ADD COLUMN input_type TEXT CHECK (input_type IN ('word', 'phrase'));

-- 4. Add unique constraint (after backfill)
ALTER TABLE words ADD CONSTRAINT words_user_original_lang_unique 
  UNIQUE (user_id, original, source_lang_id);
```

#### Repository Change (`word.repository.ts`)
- Add `findByOriginalAndSource(userId, original, sourceLangId): Promise<Word | null>` for duplicate check
- Update `create()` signature to accept `sourceLangId: number` and `inputType: 'word' | 'phrase'`

#### Save Handler Change (`translate-mode.helper.ts`)
```typescript
// Sanitize content before save
const { needsReview: _, dictionaryContext: __, ...cleanContent } = output;

// Resolve sourceLangId from in-memory language cache
const sourceLangRecord = getLang(output.sourceLang);
if (!sourceLangRecord) {
  logger.error({ sourceLang: output.sourceLang }, 'Source language not found in cache');
  await ctx.answerCallbackQuery({ text: t('translationError', lang) });
  return;
}

// Check for duplicate
const existing = await wordRepository.findByOriginalAndSource(
  ctx.user.id, output.original, sourceLangRecord.id
);
if (existing) {
  await ctx.answerCallbackQuery({ text: t('alreadySaved', lang), show_alert: true });
  return;
}

// Save with inputType
await wordRepository.create(ctx.user.id, {
  original: output.original,
  sourceLang: output.sourceLang,     // keep for backward compat during migration
  sourceLangId: sourceLangRecord.id, // new FK
  inputType: ctx.session.lastInputType ?? 'word',  // 'word' or 'phrase' (never 'sentence')
  content: cleanContent,
});
```

#### UI Polish (optional for this task, recommended for v2)
After save: edit message to show regen-only keyboard instead of removing all buttons. This allows content refinement after saving.

### Effort Estimate

| Task | Effort |
|---|---|
| DB migration (schema + backfill) | 1–2h |
| `word.repository.ts` changes | 1h |
| Save handler sanitization + dedup + inputType | 1–2h |
| Tests (repository + integration) | 2h |
| **Total** | **5–7h** |

### What NOT to Do

- ❌ Do NOT normalize `words.translations` into a separate table — premature optimization
- ❌ Do NOT add per-language save buttons — conflicts with multi-language USP
- ❌ Do NOT change the card rendering concept — it is already best-in-class
- ❌ Do NOT store `sentence` input type in dictionary — requirement explicitly forbids it
- ❌ Do NOT add the "always save" (auto-save without button tap) pattern — Duolingo does this but it removes user agency; inline button is the correct UX for Telegram
