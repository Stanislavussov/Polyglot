# Polyglot — Product Roadmap

**Owner:** Product Owner  
**Last updated:** 2026-05-16  
**Methodology:** Value × Feasibility prioritization. Defer, don't cut.

---

## Roadmap Philosophy

1. **Milestone = a coherent set of user-facing value.** Not a sprint dump.
2. **Features move forward, never backward.** A "Won't have" in v1 is a "Consider in v2" — nothing is deleted from the roadmap.
3. **Dependencies drive sequencing.** SRS needs Dictionary; Quizzes need SRS; Notifications need SRS. Build in order.
4. **Each milestone must be shippable.** Users at end of Milestone N get something meaningfully better than Milestone N-1.

---

## Current Status (as of 2026-05-16)

| Layer | Status |
|-------|--------|
| Core AI translation pipeline | ✅ Live |
| Input type detection (word / phrase / sentence) | ✅ Done (Task 27) |
| Multi-language card rendering | ✅ Live |
| Save to Dictionary (FEAT-30) | ✅ Complete |
| Dictionary Browse & Delete | ✅ Complete (Task 40) |
| Flash Cards | ✅ Complete (Task 33) |
| Daily Word Notifications | ✅ Complete (Task 41) |
| /settings Command | ✅ Complete (Task 37b) |
| Localized Bot Commands | 🟡 Partial (Task 35) |
| Composition Root & DI | ✅ Infrastructure done, incremental migration (Task 42) |
| Decouple Adapters from Infra | ✅ Complete (Task 53) |
| Docker Compose Build | ✅ Complete (Task 56) |

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

## Milestone 1 — Personal Dictionary v1 (✅ Completed)

**Theme:** Save words from translations → personal vocabulary. This is the retention anchor.

**Target:** v1.0

### Milestone 1.0 — Save to Dictionary (FEAT-30)

**Status:** ✅ Complete

**Delivered:**
- One-tap inline button save (`tr:save` callback)
- `sourceLangId` FK to `languages.id` in `words` table
- `input_type` column (`'word'` | `'phrase'`) in `words` table
- Duplicate detection — "Already in dictionary" toast
- DB migration `0005_words_dictionary_improvements`
- `wordRepository.findByOriginalAndSource()`
- Content sanitization (strip `needsReview`, `dictionaryContext`)
- Contextual Save button labels
- Post-save regen-only keyboard
- Dictionary word pipeline + flash cards (Task 33)
- Dictionary browse, search, delete (Task 40)
- Daily word notifications (Task 41)
- /settings command (Task 37b)

---

### Milestone 1.1 — Dictionary Polish (planned)

**Status:** Planned — depends on Milestone 1.0 being live.

**Scope (planned):**
- Edit saved translation (user override, does not affect shared cache) — resolves BRD open question #2
- Filter dictionary by language pair, CEFR level, register
- "Difficult words" flag — auto-populated from quiz failures (post-SRS)
- Search history (Reverso-style) — convenient but not critical
- Case-insensitive duplicate detection via `LOWER()` (REQ-3010)

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
- Leaderboards, streaks — *still won't have, and now permanently: the motivation layer shipped in Task 81
  (2026-08-25) as a decaying momentum index with no series, no XP and no comparison between users. Leaderboards
  and streaks are explicit non-goals of `@docs/adr/0002-motivation-is-a-decaying-momentum-not-a-streak.md`.*
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

**Theme:** Curated and AI-generated word sets for structured learning — framed for **level-up (A2→B1→B2)**, not survival/beginner vocabulary.

**Persona alignment (2026-07-18):** the target user is a settled émigré stuck on the A2/B1 plateau who already has the survival basics; topic content must push toward B1/B2 (register, idioms/collocations, false friends, CEFR-targeted sets), **not** "how to buy milk / talk to a doctor." See `@docs/business/backlog.md` B-07 and B-18.

**Dependencies:** Dictionary (Milestone 1.0) for "save word from topic."

### Milestone 3.0 — Ready-Made Topic Sets

**Status:** Planned. BRD §7.2.

**Scope:**
- Built-in topics oriented to level-up: idioms & collocations, register upgrades (neutral → natural/colloquial), false friends, domain vocab by interest (IT, work, culture) — each tagged with a target CEFR level. Survival/beginner packs (e.g. "Basic Phrases") are deliberately out of scope — see persona alignment above. (JSON/CSV datasets)
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
| **1.0** | Save to Dictionary (FEAT-30) | ✅ Complete | — |
| **1.1** | Dictionary Polish | 📋 Planned | BRD open question #2 (edit sentences?) |
| **2.0** | Spaced Repetition (SRS) | 🔭 Future | Needs real user data + SRS schema (Task 50) |
| **2.1** | Quizzes | 🔭 Future | Needs 2.0 |
| **2.2** | Daily Notifications (SRS) | 🔭 Future | Needs 2.0 |
| **3.0** | Ready-Made Topic Sets | 🔭 Future | Needs topic cache wired (Task 52) |
| **3.1** | AI-Generated Topics | 🔭 Future | Needs 3.0 |
| **4+** | Audio, Native App, Social | ❄️ Long-term | Needs user base + v2 data |
