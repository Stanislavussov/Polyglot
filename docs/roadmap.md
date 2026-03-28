# Polyglot — Product Roadmap

**Owner:** Product Owner  
**Last updated:** 2026-03-28  
**Methodology:** Value × Feasibility prioritization. Defer, don't cut.

---

## Roadmap Philosophy

1. **Milestone = a coherent set of user-facing value.** Not a sprint dump.
2. **Features move forward, never backward.** A "Won't have" in v1 is a "Consider in v2" — nothing is deleted from the roadmap.
3. **Dependencies drive sequencing.** SRS needs Dictionary; Quizzes need SRS; Notifications need SRS. Build in order.
4. **Each milestone must be shippable.** Users at end of Milestone N get something meaningfully better than Milestone N-1.

---

## Current Status (as of 2026-03-28)

| Layer | Status |
|-------|--------|
| Core AI translation pipeline | ✅ Live |
| Input type detection (word / phrase / sentence) | ✅ Done (Task 27) |
| Multi-language card rendering | ✅ Live |
| Basic save to dictionary (no FK, no dedup) | ✅ Partial — see FEAT-30 |
| FEAT-30 (Save to Dictionary — full) | 🟡 In Design |

---

## Milestone 0 — Foundation (✅ Completed)

**Theme:** Core translation engine. Polyglot works as a bot — translate any word/phrase.

**Delivered:**
- Monorepo + DB schema + bot setup (Tasks 01–03)
- AI translation pipeline with full `TranslateOutput` schema (Task 04)
- Token optimization + model fallback (Tasks 06, 08)
- Translate session loop (persistent mode) (Task 09)
- Idiomatic equivalents + idiom analysis (Tasks 10, 12)
- Wiktionary context enrichment (Tasks 13, 15)
- Language table refactor + FK integrity (Task 14, 23)
- Input type detection: word / phrase / sentence (Task 27)
- Diacritics-aware translation (Task 26)

**User value at end of Milestone 0:**  
User can translate any word or phrase in multi-language mode, with CEFR, synonyms, examples, register, and transcription. Sentences get a compact translation without learnable metadata.

---

## Milestone 1 — Personal Dictionary v1 (🟡 Active)

**Theme:** Save words from translations → personal vocabulary. This is the retention anchor.

**Target:** v1.0

### Milestone 1.0 — Save to Dictionary (FEAT-30)

**Status:** In Design → Implementation ready after this prioritization.

**Must-have scope (see `docs/mvp-scope.md` §2 for full MoSCoW breakdown):**

| # | Requirement | Description |
|---|-------------|-------------|
| 1 | REQ-3001 | One-tap inline button save (`tr:save` callback) |
| 2 | REQ-3002 | `sourceLangId` FK to `languages.id` in `words` table |
| 3 | REQ-3003 | `input_type` column (`'word'` \| `'phrase'`) in `words` table |
| 4 | REQ-3004 | Duplicate detection — "Already in dictionary" toast; no new entry created |
| 5 | REQ-3008 | DB migration `0005_words_dictionary_improvements` |
| 6 | REQ-3009 | `wordRepository.findByOriginalAndSource()` |

**Should-have scope (ship together with Must-haves):**

| # | Requirement | Description |
|---|-------------|-------------|
| 7 | REQ-3005 | Content sanitization (strip `needsReview`, `dictionaryContext`) |
| 8 | REQ-3006 | Contextual Save button labels: "💾 Save word" / "💾 Save phrase" |
| 9 | REQ-3007 | Post-save regen-only keyboard (regen updates saved entry via `updateContent`) |

**Product owner decisions on open questions:**

| ID | Decision |
|----|---------|
| C1 | Breaking migration: YES. Nullable FK → backfill → NOT NULL. Keep old `source_lang` until verified. |
| C2 | Target lang FK: Option B (JSONB key validation at write time). Junction table deferred to FEAT-30.1. |
| C3 | Duplicate behavior: Option A — "Already saved" toast, no new entry, no silent update. |
| C4 | Phrase card layout: button label only for now. Full layout differentiation (examples-first) deferred to v1.1. |
| C5 | Post-save regen: Option A — auto-update saved entry silently via `updateContent`. No re-save prompt. |
| C6 | Existing entries default to `inputType = 'word'` — acceptable approximation. |

**Delivery criteria:**  
A user can save a translated word or phrase with one tap. Duplicates are detected. The entry is stored with source language FK, input type, and sanitized learning content. Regen buttons remain after save to allow translation refinement.

---

### Milestone 1.1 — Dictionary Browse (FEAT-29, planned)

**Status:** Planned — depends on FEAT-30 being live.

**Theme:** Complete the save→browse loop. Users can see what they've saved.

**Scope (planned, not yet in requirements):**
- `/dictionary` command — paginated list of saved words
- Each entry: original + translations summary + CEFR + date saved
- Delete entry from list
- Basic search by text
- `word_target_langs` junction table migration (FEAT-30/C2 follow-up — Option A)
- Phrase card visual differentiation: examples-first layout for phrase entries
- Input normalization hardening (REQ-3010: case-insensitive dedup via `LOWER()`)

**Won't have in 1.1:**
- Filter by language pair — *deferred to v1.2; need user data to understand demand*
- Edit translation — *deferred to v1.2; BRD open question #2 (edit sentences?) must resolve first*
- "Word lists" / collections — *deferred to v2.0 (Topics milestone)*

---

### Milestone 1.2 — Dictionary Polish (planned)

**Status:** Planned — depends on Milestone 1.1.

**Scope (planned):**
- Edit saved translation (user override, does not affect shared cache) — resolves BRD open question #2
- Filter dictionary by language pair, CEFR level, register
- "Difficult words" flag — auto-populated from quiz failures (post-SRS)
- Search history (Reverso-style) — convenient but not critical

---

## Milestone 2 — Learning Engine (v2.0, planned)

**Theme:** Transform the dictionary into an active learning tool. This is the stickiness layer.

**Dependencies:** Requires Milestone 1.0 and 1.1 to be live with real user data.

### Milestone 2.0 — Spaced Repetition (SRS)

**Status:** Planned. BRD §7.3 — Post-MVP 2.3.

**Scope:**
- SM-2 algorithm implementation (per BRD §7.3 spec)
- SRS session trigger (`/review` command or daily notification)
- Review directions per target language (each language reviewed separately)
- Rating: Again / Hard / Good / Easy → interval recalculated
- "Flip card" direction toggle (view helper, does not affect interval)
- Overdue cards: max 20 per session, ordered by overdue duration
- On save (from FEAT-30): first review scheduled for next day

**Won't have in 2.0:**
- Leaderboards, streaks — *motivation layer; deferred to v2.2*
- Quiz impact on SRS interval — *BRD open question #9; assess after first SRS cohort*

---

### Milestone 2.1 — Quizzes

**Status:** Planned. BRD §7.4 — Post-MVP 2.4.

**Dependencies:** Milestone 2.0 (SRS) must be live; dictionary must have sufficient entries (>10 words).

**Scope:**
- Multiple choice (4 options from user's own dictionary)
- Free text input mode
- Direction: user selects before quiz (EN→RU or RU→EN)
- Quiz scope: full dictionary or specific topic
- Quiz result does NOT affect SRS interval in this release (separate session per BRD)

---

### Milestone 2.2 — Daily Notifications

**Status:** Planned. BRD §7.5 — Post-MVP 2.5.

**Dependencies:** Milestone 2.0 (SRS) for SRS-type notifications.

**Scope:**
- 1 notification/day
- User selects morning or evening delivery
- Timezone: explicit user input (Telegram does not expose timezone)
- Types: SRS word due for review / AI-suggested new word / both
- Notification content: word + translations (all user languages) + CEFR
- Actions from notification: "Save to dictionary" / "Skip"
- Inactivity fallback: 14 days no interaction → pause notifications + re-engagement message

---

## Milestone 3 — Topic Learning (v2.0 parallel track, planned)

**Theme:** Curated and AI-generated word sets for structured learning.

**Dependencies:** Dictionary (Milestone 1.0) for "save word from topic."

### Milestone 3.0 — Ready-Made Topic Sets

**Status:** Planned. BRD §7.2.

**Scope:**
- Built-in topics: Food, Travel, IT Terms, Basic Phrases (JSON/CSV datasets)
- Topic browsing via bot menu
- Translations generated on first open (AI batch)
- Shared translation cache: translations shared across users with same language pair set
- Cache invalidation on AI model change
- User selects which words to save to personal dictionary

### Milestone 3.1 — AI-Generated Topics

**Status:** Planned. BRD §7.2.

**Scope:**
- User requests "generate 20 words on topic: Sport" → AI returns word list
- Same shared-cache model as ready-made topics
- Save words from generated topic to dictionary

---

## Milestone 4 — Platform Expansion (v3+, long-term)

**Theme:** Beyond Telegram. Richer media. Social features.

**Features (all deferred — marked as Won't Have for v1/v2):**

| Feature | Why Deferred |
|---------|-------------|
| Audio pronunciation | Telegram is a poor fit. Native app only. BRD §8. |
| Native mobile app (iOS/Android) | Post-Telegram platform. BRD §8. |
| Camera scanning / OCR | Native app only. BRD §8. |
| Shared / crowdsourced dictionary | Social features — need user base first. BRD §8. |
| AI Writer / paraphrasing | Different product direction. BRD §8. |
| Verb conjugation tables | Large separate module. Not MVP. BRD §8. |
| Monetization (freemium/paid plan) | TBD — after 100+ active users. BRD open question #7. |

---

## Won't Have — Permanently Rejected

These items were evaluated and explicitly rejected, not just deferred.

| Feature | Rejection Rationale |
|---------|-------------------|
| Per-language Save buttons ("Save CS" / "Save EN") | Conflicts with multi-language USP. Polyglot's core value is saving across ALL user languages simultaneously. Research evaluation §Hypothesis G, Alt G3. |
| Auto-save (no button tap) | Removes user agency. Telegram inline button is the correct UX for explicit vocabulary building. Not learning without consent. |
| Silent dedup update (overwrite on duplicate save) | Rejected in favor of Option A (show "Already saved" toast). Silent overwrites hide state changes from users in a learning context. |
| Quiz result affecting SRS interval (v1/v2) | BRD §7.4 explicitly excludes this. Assess after first 100-user SRS cohort. |

---

## Open Questions Blocking Future Milestones

| # | Question | Blocks | Priority |
|---|----------|--------|----------|
| 2 | Does "Edit translation" allow editing example sentences too? | Milestone 1.2 | 🟡 Important |
| 5 | AI provider selection (OpenAI / Anthropic / Gemini / other) | All AI features | 🔴 Critical |
| 6 | Rate limit N — max translation requests per user per day | Cost model, monetization | 🔴 Critical |
| 7 | Monetization model (free / freemium / paid) | Roadmap scope, limits | 🔴 Critical |
| 8 | Data storage region — EU GDPR compliance required? | Infrastructure | 🔴 Critical |
| 9 | Quiz result impact on SRS interval in v2? | Milestone 2.1 | 🟠 Medium |

---

## Milestone Summary

| Milestone | Theme | Status | Key Blocker |
|-----------|-------|--------|-------------|
| **0** | Foundation + Core Translation | ✅ Complete | — |
| **1.0** | Save to Dictionary (FEAT-30) | 🟡 In Design | PO decisions documented in this roadmap |
| **1.1** | Dictionary Browse | 📋 Planned | Depends on 1.0 live |
| **1.2** | Dictionary Polish + Edit | 📋 Planned | BRD open question #2 (edit sentences?) |
| **2.0** | Spaced Repetition (SRS) | 🔭 Future | Needs 1.0 + 1.1 + real user data |
| **2.1** | Quizzes | 🔭 Future | Needs 2.0 |
| **2.2** | Daily Notifications | 🔭 Future | Needs 2.0 |
| **3.0** | Ready-Made Topic Sets | 🔭 Future | Needs 1.0 |
| **3.1** | AI-Generated Topics | 🔭 Future | Needs 3.0 |
| **4+** | Audio, Native App, Social | ❄️ Long-term | Needs user base + v2 data |
