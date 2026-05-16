# Polyglot — MVP Scope & Feature Prioritization

**Owner:** Product Owner  
**Last updated:** 2026-05-16  
**Method:** MoSCoW (Must / Should / Could / Won't for this release)

---

## 1. Scope Definition Principles

- **MVP = smallest set of Must-haves that delivers user value end-to-end.**
- Prioritize by **user value × feasibility**, not technical elegance.
- "Won't have" means "not this release" — nothing is cut permanently.
- Requirements are tagged, never modified. Source of truth for requirements remains `docs/BRD.md` and `docs/requirements/`.

---

## 2. FEAT-30 — Save to Dictionary: MVP Scope

**Feature:** Store AI translation output as a personal vocabulary entry, triggered by a Telegram inline button.  
**Source requirements:** `docs/requirements/30-save-to-dictionary.md`  
**Input types in scope:** `word` and `phrase` only. `sentence` is explicitly excluded.

---

### 2.1 MoSCoW Classification

#### 🔴 Must Have — Core value, FEAT-30 cannot ship without these

| Req | Description | Rationale |
|-----|-------------|-----------|
| **REQ-3001** | Save triggered exclusively by inline button tap (`tr:save`) | Core trigger. Already partially implemented. One-tap save is the industry-standard UX (Reverso, Lexicorn, MemoWords). No save = no feature. |
| **REQ-3002** | `sourceLangId` FK to `languages.id` in `words` table | Explicit task requirement #6: always use FK references. Consistency with `translationRequests.sourceLangId` already in schema. Non-negotiable. |
| **REQ-3003** | `input_type` dedicated column in `words` table | Needed for SRS (word vs phrase quiz differentiation) and future analytics. Storing it now is trivial; retrofitting it later is a migration + post-hoc classification problem. |
| **REQ-3004** | Duplicate detection — "Already in dictionary" toast, no new entry created | Every major competitor has this. Without it, users silently accumulate duplicates — dictionary becomes unusable for SRS. The `alreadySaved` i18n key already exists. |
| **REQ-3008** | DB migration `0005_words_dictionary_improvements` (adds `source_lang_id`, `input_type`, unique constraint) | Technical prerequisite for REQ-3002, REQ-3003, and REQ-3004. Nothing else works without it. |
| **REQ-3009** | `wordRepository.findByOriginalAndSource()` method | Technical prerequisite for REQ-3004 (duplicate detection). |

#### 🟡 Should Have — Delivers material user value; include in same release if possible

| Req | Description | Rationale |
|-----|-------------|-----------|
| **REQ-3005** | Content sanitization — strip `needsReview` and `dictionaryContext` before saving to DB | Data hygiene. `needsReview` becomes a permanently stale flag after save; `dictionaryContext` is internal Wiktionary enrichment that wastes storage and pollutes user records. Low effort (a few destructured lines in the save handler). |
| **REQ-3006** | Contextual Save button labels: "💾 Save word" vs "💾 Save phrase" | Task requirement #8. Duolingo-style contextual labels improve user clarity and save-rate confidence. Low effort (i18n-only change). |
| **REQ-3007** | Post-save keyboard: replace Save/Skip with regen-only keyboard | Allows users to refine specific language translations even after saving. Requires `wordRepository.updateContent()` on regen of a saved entry. Medium effort but directly supports the multi-language regen USP. |

#### 🔵 Could Have — Valuable but can slip to FEAT-30.1 without harming core flow

| Item | Description | Why deferred |
|------|-------------|--------------|
| **REQ-3010** | Input normalization — trim + case-insensitive duplicate check via `LOWER()` | Prevents "Doctor" vs "doctor" duplicates. Low risk without it (most users won't hit this edge case). The unique constraint already protects against race conditions. Add as a small follow-up. |
| Phrase card visual differentiation | Reorder sections (examples before CEFR/synonyms) for phrase-type cards | Research verdict: "start minimal, add layout differentiation in v2." No competitor does this; user testing should validate demand first. |
| `word_target_langs` junction table | FK integrity for target languages | Architecturally clean but zero immediate user value. JSONB key validation at write time (Option B) is sufficient for this release. |

#### ❌ Won't Have (this release) — Explicitly out of scope with rationale

| Item | Rationale for exclusion |
|------|------------------------|
| `/dictionary` browse & search command | The save→browse loop is a separate feature. Saving without browsing is a valid MVP step — users can still benefit from SRS/notifications on saved words. Deferred to v2. |
| SRS scheduling triggered on save | Depends on the SRS subsystem (Post-MVP 2.3 per BRD §7). Not building SRS in this task. |
| Save to specific topic/collection | Requires the Topics module (Post-MVP 2.2 per BRD §7). Defer. |
| Edit saved translation | BRD §7.1 "Edit translation" is a separate feature. Its "edit sentences too?" ambiguity (BRD open question #2) needs resolution first. |
| Per-language save buttons | Conflicts with Polyglot's core multi-language USP — saving across ALL learning languages simultaneously is the differentiator. Rejected per research evaluation §Hypothesis G, Alt G3. |
| Auto-save (no button tap) | Removes user agency. Telegram inline button is the correct UX. |
| Save for `sentence` input type | Explicit task requirement #7: sentence save is deferred to a future milestone. |
| Audio pronunciation on save | BRD §8 Out of Scope — Telegram is a poor fit; defer to native app. |

---

### 2.2 Open Questions — Product Owner Decisions

The following clarifications were outstanding in `docs/requirements/30-save-to-dictionary.md`. This section provides **binding product decisions**.

| ID | Question | **PO Decision** |
|----|----------|----------------|
| **C1** | Is a breaking DB migration for `sourceLang → sourceLangId` FK acceptable? | **YES — go ahead.** Strategy: add `source_lang_id` as nullable FK first, backfill from `source_lang` text via `JOIN languages ON code = source_lang`, then make NOT NULL. Retain `source_lang` text column until post-migration validation confirms all rows have a valid FK (drop in migration `0006`). Log any unresolved rows as warnings; do not silently fail. |
| **C2** | Add `word_target_langs` junction table (Option A) or validate JSONB keys at write time (Option B)? | **Option B for this release.** Validate target language codes against the in-memory language cache at write time. Option A (junction table) deferred to FEAT-30.1 — no immediate user-facing value and adds migration complexity without it. |
| **C3** | Duplicate save: (A) show "Already saved" / stop, or (B) silently update content? | **Option A — Reverso-style.** Show "ℹ️ Already in your dictionary" toast (`alreadySaved` key, `show_alert: true`). No new entry. No silent update. Rationale: explicit user feedback is preferable to silent state changes in a learning context. The user can choose to regen and re-save intentionally. |
| **C4** | Should phrase cards have different layout (examples first, no synonyms) or just different button label? | **Button label only for this release.** Same card structure for word and phrase. "Save phrase" / "Save word" label differentiation is sufficient. Full layout rethink (examples-first, no synonyms for phrases) is deferred to v2 — insufficient user data to justify it now. |
| **C5** | Post-save regen: (A) auto-update saved entry, (B) revert to unsaved state, or (C) prompt to re-save? | **Option A — auto-update silently.** When regen fires on a saved card, `wordRepository.updateContent()` updates the existing entry with the new translation. No re-save prompt. Rationale: the user is already committed (they saved the word); refining it should be frictionless. |
| **C6** | Default pre-existing `words` entries to `inputType = 'word'` — acceptable approximation? | **YES — acceptable.** Existing entries were saved before word/phrase distinction existed. Defaulting to `'word'` is a reasonable approximation. Post-hoc reclassification adds complexity with negligible benefit. |

---

### 2.3 MVP Definition Summary

**FEAT-30 MVP delivers:** A user can translate a word or phrase, tap "💾 Save word" (or "💾 Save phrase"), and have it reliably stored in their personal dictionary with full AI translation content (sanitized), source language FK integrity, input type metadata, and duplicate protection. After saving, regen buttons remain active to allow translation refinement.

**What MVP does NOT include:** Browse/search dictionary, SRS scheduling on save, topic assignment, edit translation.

**User value at MVP:** The save→regen loop is complete. A user's vocabulary grows; future SRS/notification features can immediately consume saved entries without further migration.

---

## 3. Broader Feature Scope (FEAT-30 in Context)

This section places FEAT-30 within the full product feature landscape.

### Features Implemented (as of 2026-05-16)

| Feature | Tasks | Status |
|---------|-------|--------|
| Monorepo setup | Task 01 | ✅ Done |
| Database schema | Task 02 | ✅ Done |
| Bot setup (grammY) | Task 03 | ✅ Done |
| AI translation pipeline | Task 04 | ✅ Done |
| Structured logging | Task 05 | ✅ Done |
| Partial regeneration | Task 07 | ✅ Done |
| Translate session loop | Task 09 | ✅ Done |
| Idiomatic equivalents | Task 10 | ✅ Done |
| Input limits config | Task 11 | ✅ Done (config exists, rate limiting not wired — see Task 47) |
| Idiom analysis | Task 12 | ✅ Done |
| Wiktionary JSONL | Task 13 | ✅ Done |
| Language table refactor | Task 14 | 🟡 Partial — `languages` table exists, `translationRequests` migrated, remaining tables pending |
| Context enrichment layer | Task 15 | ✅ Done |
| Auto-detect input language | Task 16 | ✅ Done |
| Language buttons — native display | Task 18 | ✅ Done |
| Input type detection & text limits | Task 27 | ✅ Done |
| Link translation_requests to languages | Task 23 | ✅ Done |
| Validation respects output config | Task 28 | ✅ Done |
| Save to Dictionary (FEAT-30) | Task 30 | ✅ Done |
| Redesign translation card | Task 31 | ✅ Done |
| User translation template | Task 32 | ✅ Done |
| Dictionary word pipeline + flashcards | Task 33 | ✅ Done |
| Persist source language & reentry reminder | Task 36 | ✅ Done |
| Normalize vocabulary schema | Task 39 | ✅ Done |
| Dictionary browse & delete | Task 40 | ✅ Done |
| Implement /settings command | Task 37b | ✅ Done |
| Daily word notifications | Task 41 | ✅ Done |
| Composition Root & DI | Task 42 | ✅ Infrastructure done, incremental migration in progress |
| Decouple adapters from infra | Task 53 | ✅ Done |
| Docker Compose Build | Task 56 | ✅ Done (files in `deploy/`) |

### Features In Design / Active

| Feature | Task | Status |
|---------|------|--------|
| AI Token Optimization | Task 06 | 🔲 To Do — prompts slimmed, but MAX_RETRIES still 2, no warnings system |
| AI Model Fallback | Task 08 | 🔲 To Do — no `fallback.ts` exists |
| Token Usage Tracking | Task 24 | 🔲 To Do |
| Diacritics-Aware Translation | Task 26 | 🔲 To Do — no `hasDiacritics` column, no validator |
| Localized Bot Commands | Task 35 | 🟡 Partial — startup + onboarding done, settings change pending |
| Lite AI Translation Validator | Task 37 | 🟡 Partial — types/schema/prompt/risk-detector designed, service not wired |
| Regen Helper Context Enrichment | Task 38 | 🔲 To Do |
| Fix Onboarding Back-Navigation | Task 36 | 🔲 To Do |
| Fix Onboarding Demo Translation | Task 38 (onboarding) | 🔲 To Do |
| Language Detection Pre-Request | Task 58 | 🔲 To Do |
| Source Language Examples | Task 57 | 🔲 To Do |
| ~~Require Source Lang Before Translate~~ | ~~Task 29~~ | ❌ Superseded by Task 58 |

### Must Have — Next Release (v1.1)

Per BRD §6 and current implementation state, the following are must-haves for the v1.1 release:

- ✅ Core AI translation (multi-language, word/phrase/sentence) — **Complete**
- ✅ Input type detection (word / phrase / sentence) — **Complete**
- ✅ FEAT-30 MVP — Save to Dictionary with FK integrity, duplicate detection, input type storage — **Complete**
- ✅ Dictionary browse, search, delete — **Complete**
- ✅ Flash cards — **Complete**
- ✅ Daily word notifications — **Complete**
- ✅ /settings command — **Complete**
- 🟡 Wire rate limiting into translation flow (Task 47) — infrastructure exists, not wired
- 🔲 Token optimization (Task 06) — partial, needs warnings system + MAX_RETRIES reduction

---

## 4. Prioritized Backlog (Post FEAT-30)

Items below are tagged with priority for the roadmap. See `docs/roadmap.md` for milestone assignments.

| Feature | MoSCoW | Milestone | Notes |
|---------|--------|-----------|-------|
| Wire rate limiting (Task 47) | Must | v1.1 | Infrastructure exists (`translationRequests` table), needs wiring |
| Token optimization (Task 06) | Must | v1.1 | Prompts slimmed, needs warnings system + MAX_RETRIES = 1 |
| AI model fallback (Task 08) | Should | v1.1 | No `fallback.ts` exists yet |
| Token usage tracking (Task 24) | Could | v1.1 | Visibility + debugging |
| Diacritics-aware translation (Task 26) | Should | v1.1 | Critical for Czech/Polish quality |
| Language detection pre-request (Task 58) | Should | v1.1 | Replaces source lang menu |
| Regen helper context enrichment (Task 38) | Should | v1.1 | Regen misses Wiktionary context |
| Fix onboarding back-navigation (Task 36) | Should | v1.1 | UX polish |
| Fix onboarding demo translation (Task 38-onboarding) | Should | v1.1 | Shows placeholder instead of real AI result |
| Source language examples (Task 57) | Could | v1.1 | Bilingual sentence pairs |
| Persistent session storage (Task 43) | Must | v1.1 | Survives bot restart |
| Unify language cache (Task 44) | Should | v1.1 | Single source of truth |
| Extract domain types (Task 45) | Must | v1.1 | Clean adapter swappability |
| Split translate-mode.helper (Task 46) | Should | v1.1 | Developer velocity |
| Extract notification scheduler (Task 48) | Should | v1.2 | Reliability at scale |
| Centralize adapter config (Task 49) | Could | v1.1 | Remove process.env leaks |
| SRS schema foundation (Task 50) | Must | v2.0 | Prerequisite for Milestone 2.0 |
| Modular bot registration (Task 51) | Could | v1.1 | Clean index.ts |
| Wire topic cache (Task 52) | Should | v2.0 | Prerequisite for Milestone 3.0 |
| Fix barrel export conflicts (Task 54) | Could | v1.1 | Prevent TS2308 collisions |
| Health check & observability (Task 55) | Should | v1.1 | Production reliability |
| Edit saved translation | Should | v1.1 | BRD §7; open question #2 must resolve first |
| Ready-made topic sets | Should | v2.0 | BRD §7.2 |
| AI-generated topics | Should | v2.0 | BRD §7.2 |
| Spaced Repetition (SRS / SM-2) | Must (v2) | v2.0 | BRD §7.3 — depends on dictionary |
| Quizzes | Should (v2) | v2.0 | BRD §7.4 — depends on SRS |
| SRS notifications | Should (v2) | v2.0 | BRD §7.5 — depends on SRS |
| Audio pronunciation | Won't (MVP/v2) | v3+ | BRD §8 — defer to native app |
| Native mobile app | Won't (MVP/v2) | v3+ | BRD §8 — post-Telegram |
