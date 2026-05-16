# Competitor Intelligence — Dictionary Storage & Save-to-Dictionary UX

**Date:** 2026-03-28
**Scope:** How competitor language-learning apps store AI/translation output to a personal dictionary, and how they render results with inline save actions.

---

## 1. What We're Solving

The task is to implement "Save to Dictionary" — triggered by an inline Telegram button — that stores AI translation output as a personal vocabulary entry. The analysis covers:

- What parts of a translation result are worth storing (fields, FK integrity)
- The best UX patterns from competitors for the save button flow
- How competitors render results differently for word vs phrase vs sentence
- What Polyglot already has vs what is missing

---

## 2. Current State of Polyglot (as of 2026-03-28)

### ✅ Already Implemented

| Feature | Status | Notes |
|---|---|---|
| `tr:save` inline button on translation card | ✅ | `buildTranslationKeyboard` — Row 2: Save + Skip |
| `handleSaveCallback` saves to `words` table | ✅ | In `translate-mode.helper.ts` |
| Full `TranslateOutput` stored as JSONB blob | ✅ | `words.content` field |
| Save disabled for sentence input type | ✅ | Task 27 — no `pendingTranslation` for sentences |
| Confirmation message after save | ✅ | Card edited with "Saved to dictionary" text |
| Soft delete (`isActive = false`) | ✅ | `wordRepository.delete()` |
| `wordRepository.create/findByUser/findById/search` | ✅ | Full CRUD in DB layer |
| Word and phrase get same rendering | ✅ | `renderTranslation()` used for both |

### ❌ Missing / Needs Change

| Gap | Impact | Priority |
|---|---|---|
| `words.sourceLang` is `text`, not FK to `languages.id` | HIGH — violates FK requirement from task | Must fix |
| No `inputType` column in `words` table | MEDIUM — needed for SRS, quiz, future features | Should add |
| No `sourceLangId` FK linkage to `languages` | HIGH — breaks referential integrity | Must fix |
| No target language FK linkage (only JSONB keys) | MEDIUM — discoverable from content, but no relational integrity | Plan |
| Word vs phrase rendering is identical | MEDIUM — UX clarity for learners | Plan |
| No duplicate detection | HIGH — user can save same word multiple times | Must fix |
| No browsable dictionary UI in bot | HIGH — save flow without browse flow is incomplete | Plan |
| No word count or pagination in dictionary | LOW | Future |

---

## 3. Competitor Analysis

### 3.1 Reverso Context (Web + Mobile)

**Save UX:**
- "Add to Vocabulary" button appears on every translation result card
- One tap — no confirmation dialog
- If word already exists: button shows "In Vocabulary" (prevents duplicate)
- After save: toast notification "Saved to vocabulary"

**What they store per entry:**
- Source word/phrase
- Target translation(s) — up to 3 variants
- Example sentences (corpus-sourced, not AI-generated) — stored with the entry
- Tags: formal/informal, domain tags
- **No CEFR level** — Reverso does not use CEFR

**Rendering:**
- Source + translation on one line, bold
- Examples shown inline, expandable
- Parts-of-speech badge (noun, verb, adj.)
- Grammar info (gender, conjugation hint for verbs)

**Vocabulary organization:**
- Flat list + search
- "Word Lists" (collections) — user-defined groupings
- Filter by language pair

**Key insight for Polyglot:**
> Reverso's "already saved" detection is the single most-requested UX feature in language tools. Showing a filled bookmark icon instead of "Save" prevents duplicates and communicates state immediately.

---

### 3.2 Anki (Desktop + Mobile + Web)

**Save UX:**
- No inline "save from translation" — requires manual card creation
- Cards have: Front (question), Back (answer), Tags, Deck assignment
- Audio support on both sides

**What they store per entry (Note type "Basic"):**
- Front field (any HTML/text/media)
- Back field (any HTML/text/media)
- Tags (user-defined labels)
- Deck (collection grouping)

**Rendering:**
- Minimal, high-contrast card
- Front shows question only → flip → Back shows answer
- Progress info: due date, ease factor (SRS metadata)

**Key insight for Polyglot:**
> Anki proves the JSONB blob model works long-term. A flexible `content` field accommodates future schema changes without migrations. However, critical fields used for filtering/indexing (like CEFR, sourceLang) should be extracted to dedicated columns.

---

### 3.3 Duolingo (Mobile)

**Save UX:**
- No user-initiated save — words are added automatically from lessons
- "Practice" button to review weak words
- No external translation save

**What they store per entry:**
- Word
- Translation (single target lang)
- Audio
- "Strength" meter (SRS level 1–5)
- Image (for visual associations)

**Rendering:**
- Word card with image + pronunciation button
- Compact list view: word → translation, strength bar

**Key insight for Polyglot:**
> Duolingo's "strength" visual (decaying bar) is a compelling SRS metaphor for future use. Store CEFR level as a dedicated column to compute quiz difficulty without parsing JSONB.

---

### 3.4 Quizlet (Web + Mobile)

**Save UX:**
- Manual entry: Term + Definition + optional image
- No "save from translation result" in native flow
- Third-party integrations (browser extension) support translate-and-save

**What they store per entry:**
- Term (word/phrase in any language)
- Definition (translation or description)
- Optional: image, audio

**Vocabulary organization:**
- "Sets" (topic-based decks)
- Tags, privacy (public/private/class)

**Key insight for Polyglot:**
> Quizlet sets = Polyglot topics. The "save a word to a specific set/topic" pattern is popular. Future: allow saving into a specific topic folder.

---

### 3.5 Memrise (Mobile)

**Save UX:**
- No custom save — learns from pre-built courses
- "Difficult words" list auto-populated by performance

**What they store:**
- Word, translation, audio, mnemonic/image
- Auto-scheduling (not user-controlled)

**Key insight for Polyglot:**
> Memrise's "difficult words" (auto-detected from quiz failures) is a post-MVP SRS enhancement. For now, all saved words should be treated as equally important.

---

### 3.6 Telegram Bots — Direct Competitors

#### @LinguaBot
- `/save` command after translation saves last result
- **No inline button** — user must type a command
- Stores: original + translation only (no examples, no CEFR)
- **Weakness:** no context or metadata stored

#### @DailyEnglishBot
- Daily word sent as message with "💾 Save" button
- Stores: word + short definition + example
- Button interaction: taps to save, shows "✅ Saved!" edit in-place

#### @LearnEnglishBot
- Uses inline buttons: `[💾 Save]` `[➡️ Next]`
- Stores: word, transcription, definition, one example
- **No multi-language support** — single EN→RU pair only

**Key insight from Telegram bots:**
> The `[💾 Save]` → edit message to `[✅ Saved!]` pattern (no new message) is the cleanest UX in Telegram. DailyEnglishBot does this well. Current Polyglot approach (edit card text to add "saved to dict") is correct but could be more visually distinct.

---

### 3.7 DeepL (Web + Mobile)

**Save UX:**
- "Add to glossary" for word/phrase translations
- Glossary is a translation override (custom translation override), not a learning dictionary
- Stores: source → target pair in a specific language direction

**What they store:**
- Source term
- Target term  
- Language pair (FK-like, strict structure)

**Key insight for Polyglot:**
> DeepL stores `source_lang` and `target_lang` as structured fields, not text blobs. Language-pair referential integrity matters at scale.

---

### 3.8 Linguee (Web)

- No save feature — pure lookup tool
- Rich examples from real-world corpora (similar to Reverso)
- Context examples grouped by domain/register

**Key insight:**
> Linguee-style examples (domain-tagged) map well to Polyglot's existing `Example.context` field (formal/colloquial/professional). This field is worth storing.

---

## 4. What to Store Per Dictionary Entry

Based on competitor analysis and Polyglot's `TranslateOutput` structure:

### 4.1 Field-by-Field Decision

| Field from `TranslateOutput` | Store? | Column or JSONB | Rationale |
|---|---|---|---|
| `original` | ✅ YES | Dedicated column | Always needed for display and search |
| `sourceLang` | ✅ YES — **as FK** | `sourceLangId INTEGER → languages.id` | Task requirement: FK not text |
| `inputType` | ✅ YES | Dedicated column `input_type TEXT` | Needed for SRS (word vs phrase quiz modes differ), analytics |
| `emoji` | ✅ YES | JSONB content | Visual identity; no indexing needed |
| `register` | ✅ YES | JSONB content (+ consider extracted column) | Formality level for filtering in future |
| `translations[lang].text` | ✅ YES | JSONB content | Core learning value |
| `translations[lang].cefr` | ✅ YES | JSONB content | Difficulty for SRS scheduling |
| `translations[lang].transcription` | ✅ YES | JSONB content | Pronunciation aid |
| `translations[lang].register` | ✅ YES | JSONB content | Per-language formality |
| `translations[lang].synonyms` | ✅ YES | JSONB content | Vocabulary richness |
| `translations[lang].examples` | ✅ YES | JSONB content | Core learning value — exactly what Reverso stores |
| `translations[lang].alternatives` | ✅ YES | JSONB content | Alternative renderings |
| `translations[lang].equivalentNote` | ✅ YES | JSONB content | Idiomatic context explanation |
| `needsReview` | ⚠️ OPTIONAL | JSONB content | Low value to store — it's a transient AI signal |
| `dictionaryContext` | ❌ NO | Not stored | Wiktionary enrichment tool, not learning content |
| `sourceLang` as text (current) | ❌ REMOVE | Replace with FK | Violates relational integrity |

### 4.2 Target Language FK Tracking

**Proposal:** Add a `word_target_langs` junction table to link each saved word entry to its target languages via FK:

```
word_target_langs
  id           SERIAL PK
  wordId       INTEGER FK → words.id (CASCADE DELETE)
  languageId   INTEGER FK → languages.id
  UNIQUE (wordId, languageId)
```

**Why:** The current model stores target language codes as JSONB keys (e.g., `{"en": {...}, "de": {...}}`). This means target language references live only as strings inside a blob — no referential integrity. A junction table enables:
- Querying "all words learned in German" without parsing JSONB
- Enforcing FK to `languages` table
- Future: per-language SRS scheduling, per-language quiz mode

**Effort:** Low (one migration + one repository update)
**Impact:** High for long-term data integrity

### 4.3 Recommended Updated `words` Schema

```sql
words (revised)
  id           SERIAL PK
  userId       INTEGER FK → users.id CASCADE DELETE
  original     TEXT NOT NULL
  sourceLangId INTEGER FK → languages.id  -- CHANGE: was text "source_lang"
  inputType    TEXT NOT NULL DEFAULT 'word'  -- NEW: 'word' | 'phrase'
  content      JSONB NOT NULL  -- full TranslateOutput (minus dictionaryContext)
  isActive     BOOLEAN DEFAULT true
  createdAt    TIMESTAMP DEFAULT NOW()
  updatedAt    TIMESTAMP DEFAULT NOW()
```

**Migration strategy (BREAKING — needs careful rollout):**
1. Add `sourceLangId` column (nullable initially)
2. Backfill `sourceLangId` from `sourceLang` text via `JOIN languages ON code = sourceLang`
3. Make `sourceLangId` NOT NULL
4. Add `inputType` column with default `'word'`
5. Drop `sourceLang` text column (or keep as deprecated until confirmed clean)

---

## 5. Rendering by Input Type — Best Approach

Based on competitor analysis, the recommended rendering pattern is:

### 5.1 Word card (word rendering — 1–2 word tokens)

```
🩺 doctor  ← emoji + bold original word
Register: neutral          ← global register

🇩🇪 DE: Arzt [aːrtst]     ← flag + translation + transcription
  ∙ Doktor (neutral) — Mediziner (professional)  ← alternatives
CEFR: B1 · neutral         ← difficulty + register
Synonyms: Heilkundige (formal)
Examples:
  📎 Der Arzt diagnostizierte Grippe. → The doctor diagnosed flu.
  💬 Mein Arzt hat mir empfohlen... → My doctor recommended...

[🔄 DE] [🔄 EN]
[💾 Save word]  [✗ Skip]
```

**Visual marker: 📚 or the word emoji is shown in the card header.**

### 5.2 Phrase card (phrase rendering — 3–6 word tokens)

Phrases differ from words:
- CEFR is less relevant as a "difficulty" signal for a phrase learnable as a unit
- Examples matter more (show the phrase in context)
- Alternatives less common for established phrases
- Button label should say "Save phrase" not "Save word" (Duolingo-style specificity)

```
💬 good morning  ← phrase indicator emoji + bold text
Register: neutral

🇩🇪 DE: Guten Morgen
CEFR: A1 · neutral
Examples:
  💬 Guten Morgen! Wie geht es dir? → Good morning! How are you?
  📎 Guten Morgen, meine Damen und Herren. → Good morning, ladies and gentlemen.

[🔄 DE] [🔄 EN]
[💾 Save phrase]  [✗ Skip]
```

**Key difference from word card:**
- No "Synonyms" block (phrases rarely have pure synonyms)
- Examples are shown first (phrases are best understood in context)
- Button label: "Save phrase" (Duolingo-style contextual labels improve save rates)

### 5.3 Sentence card (already implemented in Task 27)

No Save button — Regen only. Compact card, no CEFR/synonyms/alternatives.

---

## 6. Duplicate Detection — Critical Missing Feature

**Problem:** Current implementation allows saving the same word/phrase multiple times, silently creating duplicate rows.

**Competitor approach:**
- Reverso: "In Vocabulary" button state — can't click save twice
- Anki: warns on duplicate note when adding manually
- Quizlet: shows existing term in suggestions

**Proposed solution for Polyglot:**

When user taps Save:
1. Query `words` table: `WHERE userId = ? AND original = ? AND sourceLangId = ?`
2. If entry exists:
   - Option A (recommended): Edit message button to `[✅ Already saved]` — no-op click, no new entry
   - Option B: Ask "Update existing?" — more complex UX
3. If entry does not exist: save normally, edit to `[✅ Saved!]`

**DB query needed:** Add `findByOriginalAndSourceLang(userId, original, sourceLangId)` to `wordRepository`.

---

## 7. Prioritized Feature Proposals

Using the **impact × effort** priority matrix:

### 🔥 Do Now (High Impact + Low–Medium Effort)

| # | Feature | Impact | Effort | Score |
|---|---|---|---|---|
| 1 | Add `inputType` column to `words` table | HIGH — enables SRS/quiz differentiation | LOW | 🔥🔥 |
| 2 | Change `sourceLang` text → `sourceLangId FK` in `words` table | HIGH — referential integrity + task requirement | MEDIUM (migration + backfill) | 🔥🔥 |
| 3 | Duplicate detection: check before save, show "Already saved" state | HIGH — UX quality, prevents junk data | LOW | 🔥🔥 |
| 4 | Different Save button labels: "Save word" vs "Save phrase" | MEDIUM — UX clarity | LOW (i18n only) | 🔥 |
| 5 | Add `word_target_langs` junction table for FK integrity on target langs | HIGH — data integrity | MEDIUM | 🔥 |

### 📋 Plan (Medium-High Impact + Medium Effort)

| # | Feature | Impact | Effort | Score |
|---|---|---|---|---|
| 6 | Visual differentiation of word vs phrase card (header, examples-first for phrase) | HIGH — learning UX | MEDIUM (renderer change) | 📋 |
| 7 | Bot command `/dictionary` — browse saved words | HIGH — completes the save→browse loop | MEDIUM | 📋 |
| 8 | Store `needsReview` flag on save if translation had uncertainty | MEDIUM | LOW | 📋 |

### 🔭 Future (High Impact + High Effort)

| # | Feature | Impact | Effort | Score |
|---|---|---|---|---|
| 9 | Save into a specific topic/collection | HIGH — organization | HIGH | 🔭 |
| 10 | "Flip card" review UI for saved entries | HIGH — SRS foundation | HIGH | 🔭 |
| 11 | Edit saved translation (user override) | MEDIUM — BRD §7 | HIGH | 🔭 |

### ❄️ Skip (Low Impact or High Effort with Low Return)

| # | Feature | Notes |
|---|---|---|
| 12 | Leaderboards / social save streaks | Low priority for MVP per rules |
| 13 | Image association on save (Memrise-style) | Telegram UI too limiting |
| 14 | Audio pronunciation on save (Duolingo-style) | Deferred per BRD §8 |

---

## 8. Already Have (Do Not Re-Propose)

| Feature | alreadyHave |
|---|---|
| Inline Save button on translation card | ✅ |
| Save disabled for sentence input type (Task 27) | ✅ |
| Words stored with original + content JSONB | ✅ |
| Soft delete (`isActive` flag) | ✅ |
| `wordRepository` CRUD methods | ✅ |
| Full TranslateOutput stored in content JSONB | ✅ |
| Session-based `pendingTranslation` for save flow | ✅ |
| Skip button (discard without saving) | ✅ |
| Regen button preserves Save/Skip (word/phrase) | ✅ |

---

## 9. Clarifications Needed ⚠️

The following points are **unclear from the task description and current codebase**. They need product/architect decisions before implementation:

### C1 — Breaking schema migration for `sourceLang → sourceLangId`

The current `words.sourceLang` is a `TEXT` column. Task requires FK to `languages`. 

**Question:** Is a schema migration acceptable? This is a BREAKING CHANGE — requires:
- Migration adding `sourceLangId INTEGER FK → languages.id`
- Backfill script: `UPDATE words SET sourceLangId = (SELECT id FROM languages WHERE code = words.sourceLang)`
- Removing/deprecating the old `sourceLang` text column

**Risk:** Words saved with source languages not yet in the `languages` table would lose their lang reference. Need to verify all `sourceLang` values in the words table exist in `languages`.

---

### C2 — Target language FK strategy

The task says "use FK to existing tables." Currently, target languages are stored as JSONB keys (string codes like `"en"`, `"de"`) inside `words.content`.

**Options:**

**Option A — Junction table `word_target_langs`:**
```
word_target_langs(wordId FK → words.id, languageId FK → languages.id)
```
Proper FK integrity. Enables queries like "all words with German translation." Requires a new table + migration.

**Option B — Keep JSONB keys, but validate against `languages` at write time:**
Keep content as-is but ensure keys match valid language codes from `languages` table. No schema change, but no hard FK constraint.

**Which option is preferred?** Option A is architecturally correct but adds complexity. Option B is a pragmatic interim.

---

### C3 — Duplicate detection behavior

When user tries to save a word they already saved:

- **Option A (Reverso-style):** Show "Already saved" button state. No new entry. No update.
- **Option B (Update-on-duplicate):** Update the existing entry with the latest AI translation (overwrite content).
- **Option C (Allow duplicates):** No change. User may save same word multiple times (different target languages possible in future).

**Recommendation:** Option A (Reverso-style) — best UX, prevents junk data, no ambiguity.

---

### C4 — Phrase rendering vs word rendering

The task says "different rendering/buttons for word vs phrase." Currently both use identical `renderTranslation()`.

**Question:** How different should phrase rendering be from word rendering?

- **Minimal:** Just change the button label ("Save phrase" vs "Save word") and add a phrase indicator emoji to the header
- **Medium:** Re-order card sections (show examples before CEFR/synonyms for phrases)
- **Full redesign:** Remove CEFR and synonyms from phrase cards entirely (they're less relevant)

**Recommendation:** Start with Minimal (button label + header indicator), plan Medium for v2. Full redesign is not justified until user testing shows confusion.

---

### C5 — What happens on Save when a word has been regenerated for one language?

**Scenario:** User translates "doctor" → German + French. They regenerate German translation. Then tap Save.

**Current behavior:** `pendingTranslation` is updated on regen → Save captures the latest merged output (all languages including regenerated).

**Question:** Is this the desired behavior? It appears correct but the task should confirm that a re-generated single-language translation should still save the full multi-language entry.

---

### C6 — `inputType` storage for existing saves

When we add `inputType` column to `words` table with default `'word'`, existing entries will default to `'word'`. But some existing entries may be phrases. Is this acceptable as a data approximation, or do we need to re-classify existing entries?

**Recommendation:** Acceptable approximation. All existing entries were saved before phrase-vs-word distinction existed, and most are likely short words anyway.

---

## 10. Recommended Implementation Sequence

Based on priority and dependencies:

```
Phase 1 (Schema / Migration):
  → Add inputType TEXT column to words table (DEFAULT 'word')
  → Add sourceLangId INTEGER FK → languages.id to words table
  → Backfill sourceLangId from sourceLang text
  → (Optional) Add word_target_langs junction table

Phase 2 (Save Logic):
  → Pass inputType when calling wordRepository.create()
  → Use sourceLangId (FK lookup via languageRepository.findByCode())
  → Add duplicate detection (findByOriginalAndSourceLang)
  → Handle "Already saved" button state on duplicate

Phase 3 (Bot Rendering):
  → Add word vs phrase visual distinction in card header
  → Different button label: "Save word" vs "Save phrase"
  → Phrase card: show examples more prominently
  → Update i18n keys: saveWord, savePhrase (instead of generic saveToDictionary)

Phase 4 (Browse Dictionary — post-save loop):
  → /dictionary command with paginated word list
  → Each entry shows original + translations summary
  → Delete option per entry
```

---

## 11. Summary

The "Save to Dictionary" feature **partially exists** in Polyglot. The save button, session flow, and basic DB write are all implemented. What is **missing** is:

1. **FK integrity**: `sourceLang` must become `sourceLangId FK` (hard requirement from task)
2. **Input type stored**: `inputType` column needed on `words` table
3. **Duplicate detection**: prevent saving same word twice (critical UX gap vs competitors)
4. **Word vs phrase rendering differentiation**: different headers + button labels
5. **Target language FK tracking**: optional but architecturally clean via junction table

The most important competitor insight is **Reverso Context's "Already saved" detection** — it prevents duplicates and communicates state clearly. This should be the first new feature built.
