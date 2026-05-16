# Polyglot — Business Requirements Document (BRD)

---

## 1. Problem Statement

A person speaks their native language and is simultaneously learning 2+ foreign languages. When studying new vocabulary, a recurring problem arises: they know a word in one language but forget it in another. Existing tools do not solve this:

- **Duolingo, Anki** — work in a single native → target language pair
- **Reverso, DeepL** — provide excellent context but only for one language pair at a time
- **Lexicorn** — Telegram bot with similar services but no multi-language simultaneous saving

**Real example:** A Russian-speaking user wants to learn "Hippocratic Oath" in both Czech and English. They find the translation, but after some time forget how it sounds in one of the languages and are forced to search again.

**Polyglot solves this:** a word is saved across all user languages simultaneously, with usage examples, CEFR level, and the system reminds the user to review it at the right moment.

---

## 2. Target Audience

| Segment                        | Description                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Emigrants                      | Learning the language of a new country while maintaining a second foreign language |
| Polyglots                      | Actively studying 2+ languages in parallel                                         |
| Multilingual environment users | Work, family, or relocation requiring multiple languages                           |

---

## 3. Competitive Analysis

### Direct Competitors (Telegram)

| Feature                                  | **Polyglot**    | **Lexicorn**      | **MemoWords AI** |
| ---------------------------------------- | --------------- | ----------------- | ---------------- |
| Multi-language translation (all at once) | ✅ Core feature | ✅ via /languages | ⚠️ Unclear       |
| Personal dictionary                      | ✅              | ✅                | ✅               |
| Spaced repetition                        | ✅ SM-2         | ✅ FSRS           | ✅ Custom        |
| CEFR level display                       | ✅              | ❌                | ❌               |
| Word register (slang / formal / neutral) | ✅              | ❌                | ❌               |
| Synonyms with register                   | ✅              | ❌                | ❌               |
| Ready-made topic sets                    | ✅              | ❌                | ✅               |
| AI topic generation                      | ✅              | ❌                | ❌               |
| Quizzes                                  | ✅              | ❌                | ✅               |
| Daily push notifications                 | ✅ Telegram     | ✅ Telegram       | ✅ Telegram      |
| "Flip card" direction                    | ✅              | ❌                | ❌               |
| Edit translation                         | ✅              | ❌                | ❌               |
| Flashcards                               | ✅              | ❌                | ❌               |
| Audio pronunciation                      | ❌ (post-MVP)   | ✅                | ❌               |
| Monetization                             | TBD             | ✅ Paid plan      | ✅ Freemium      |

### Unique Positioning of Polyglot

> Polyglot is the only Telegram bot designed specifically for users learning **2+ languages simultaneously**, offering a single translation request that returns results for **all target languages at once**, enriched with CEFR level, word register, synonyms, and contextual examples.

### Why users will choose Polyglot over Lexicorn

- Word **register** (slang / colloquial / neutral / literary / professional) — not available in Lexicorn
- **Synonyms with register** per translation
- **AI-generated topic sets** on demand
- **Quizzes** (multiple choice + text input)
- **CEFR level** displayed on each card
- **Edit translation** — user can override AI output
- **Flashcards** — spaced repetition powered review sessions

---

## 4. Platform

**Telegram Bot** — sole platform for MVP.

Rationale: zero installation barrier, existing notification infrastructure, keyboard-based UX sufficient for MVP feature set.

Audio features (pronunciation) are deferred — Telegram is a poor fit for audio-first UX. Planned for native app post-MVP.

---

## 5. Onboarding

Goal: understand the user and immediately demonstrate value. Maximum 3 steps.

| Step | Question                                       | Example                                                  |
| ---- | ---------------------------------------------- | -------------------------------------------------------- |
| 1    | What is your native language?                  | Russian                                                  |
| 2    | Which languages are you learning? (select 1–4) | Czech, English                                           |
| 3    | Demo translation in onboarding                 | User enters any word and **immediately sees the result** |

**Step 3 is the "aha moment":** the user is not yet fully registered, but already sees the product value.

**Language limit:** maximum 4 target languages. This is a product decision to keep the card UI readable in Telegram. A user attempting to add a 5th language receives a message explaining the limit.

---

## 6. MVP Features

### 6.1 Word / Phrase / Sentence Translation ✅

The user enters anything — a word, phrase, idiom, or fixed expression. The AI returns one message per target language containing:

| Field             | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| Translation       | With auto-assigned emoji                                                    |
| CEFR level        | A1–C2, determined by AI per language                                        |
| Transcription     | Where applicable (e.g. Czech, Japanese)                                     |
| Word register     | Slang / colloquial / neutral / literary / professional                      |
| Synonyms          | With their respective register labels                                       |
| Example sentences | 2–3 sentences covering different contexts: formal, colloquial, professional |

**Input type routing:**

- **Word / Phrase:** Full card with CEFR, transcription, register, synonyms, examples; Save/Skip buttons shown
- **Sentence:** Compact card with primary translation only; Regen-only keyboard (no Save/Skip)

Input type detection is automatic (per Task 27).

### 6.2 Save to Dictionary ✅ (FEAT-30)

One-button save directly from the translation result. Available for **word** and **phrase** input types only.

- Save button label reflects input type: "💾 Save word" or "💾 Save phrase"
- Content stored: emoji, register, per-language translations (text, CEFR, transcription, register, synonyms, examples, alternatives, expression type) — internal pipeline fields excluded
- Source language stored as FK to `languages` table (not plain text)
- Input type stored as dedicated column for future SRS/quiz differentiation
- Duplicate detection: tapping Save on an already-saved word shows "Already in dictionary" instead of creating a duplicate entry
- After save: Save/Skip buttons replaced by regen-only keyboard, allowing translation refinement of the saved entry
- Post-save regen auto-updates the saved entry silently

**Schema:** Normalized `vocabularyEntries` + `vocabularyTranslations` tables (per Task 39). Each entry stores parent metadata (original, sourceLangId, inputType, emoji, register) and per-target-language rows with full translation details.

**Detailed requirements:** `docs/requirements/30-save-to-dictionary.md` (FEAT-30)

### 6.3 Dictionary Browse & Delete ✅

- `/dictionary` command shows paginated list of saved words
- Each entry displays: original text, source language, CEFR summary, date saved
- Delete entry with confirmation prompt
- Basic text search within dictionary
- Soft delete preserves data integrity

**Detailed requirements:** Task 40 — `docs/tasks/finished/40-dictionary-browse-and-delete.md`

### 6.4 Flash Cards ✅

Config-driven word pipeline delivering words from personal dictionary as flash cards.

- `/flashcard` command launches card review session
- Card front: word + source language tag
- Card back: all target language translations with CEFR, transcription, register
- Reveal/Next/Quit navigation
- Deck summary on completion with restart option
- Same pipeline architecture powers notifications and future quiz output

**Detailed requirements:** Task 33 — `docs/tasks/finished/33-dictionary-word-pipeline-and-flashcards.md`

### 6.5 Daily Word Notifications ✅

Scheduled Telegram push notifications with words from the user's personal dictionary.

- User selects delivery time (morning / evening) and timezone
- Word-of-the-day from user's saved vocabulary
- Notification content: word + all translations + CEFR level
- "Save" / "Skip" actions from notification
- Inactivity pause: if user is inactive for 14 days, notifications pause automatically
- Re-engagement message sent when user returns

**Notification types:** AI-suggested word (`suggested`) | SRS due word (`srs`) | Both alternating (`both`)

**Detailed requirements:** Task 41 — `docs/tasks/finished/41-daily-word-notifications.md`

### 6.6 Settings Command ✅

- `/settings` command for profile management
- Change native language
- Add/remove target learning languages (1–4 max)
- Set notification time (morning / evening)
- Set notification type (suggested / srs / both)
- Set interface language (UI language)

**Detailed requirements:** Task 37 — `docs/tasks/finished/37-implement-settings-command.md`

---

## 7. Roadmap — Milestones

### Milestone 0 — Foundation ✅ (Completed)

**Theme:** Core translation engine. Polyglot works as a bot — translate any word/phrase.

**Delivered:**

- Monorepo + DB schema + bot setup (Tasks 01–03)
- AI translation pipeline with full `TranslateOutput` schema (Task 04)
- Token optimization + model fallback (Tasks 06, 08)
- Translate session loop (persistent mode) (Task 09)
- Idiomatic equivalents + idiom analysis (Tasks 10, 12)
- Wiktionary context enrichment (Tasks 13, 15)
- Language table refactor + FK integrity (Tasks 14, 23)
- Input type detection: word / phrase / sentence (Task 27)
- Diacritics-aware translation (Task 26)
- Partial regeneration per language (Task 07)
- Auto-detect input language (Task 16)
- Language buttons with native display names (Task 18, 25)
- Persist source language across sessions + reentry reminder (Task 36)
- User translation templates (Task 32)
- Translation output respects template config (Task 28)

**User value at end of Milestone 0:**
User can translate any word or phrase in multi-language mode, with CEFR, synonyms, examples, register, and transcription. Sentences get a compact translation without learnable metadata.

---

### Milestone 1.0 — Personal Dictionary v1.0 ✅ (Completed)

**Theme:** Save words from translations → personal vocabulary. This is the retention anchor.

**Delivered:**

- ✅ FEAT-30: Save to Dictionary with FK integrity, duplicate detection, input type tracking
- ✅ Task 33: Dictionary word pipeline + flash cards
- ✅ Task 40: Dictionary browse, search, delete
- ✅ Task 41: Daily word notifications
- ✅ Task 37: /settings command

**User value at end of Milestone 1.0:**
User can translate a word, save it to their personal dictionary with one tap, browse and search their saved vocabulary, review words using flash cards, and receive daily word notifications. The full save → review loop is functional.

---

### Milestone 1.1 — Dictionary Polish 🔭 (Planned)

**Scope:**

- Edit saved translation (user override, does not affect shared cache)
- Filter dictionary by language pair, CEFR level, register
- "Difficult words" flag — auto-populated from quiz failures (post-SRS)
- Search history (Reverso-style) — convenient but not critical
- Case-insensitive duplicate detection via `LOWER()` for save dedup

**Blocked by:** BRD open question #2 (edit sentences?)

---

### Milestone 2.0 — Learning Engine 🔭 (Planned)

**Theme:** Transform the dictionary into an active learning tool. This is the stickiness layer.

**Dependencies:** Requires Milestone 1.x to be live with real user data.

#### Milestone 2.0 — Spaced Repetition (SRS)

Algorithm: **SM-2**

| Rule                | Detail                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| First review        | Scheduled for next day after saving                                                                                          |
| Directions          | Each target language reviewed separately                                                                                     |
| Rating              | User rates recall: Again / Hard / Good / Easy → interval recalculated                                                        |
| Minimum ease factor | 1.3 (standard SM-2 floor)                                                                                                    |
| Maximum interval    | 365 days                                                                                                                     |
| Overdue cards       | If user returns after inactivity, overdue cards are shown in order of overdue duration, not all at once (max 20 per session) |
| Flip direction      | Flip does **not** affect SRS interval — it is a view helper only                                                             |

#### Milestone 2.1 — Quizzes

- **Question format:** show a word in one language → user inputs or selects translation in another language
- **Modes:** multiple choice (4 options) / free text input
- **Wrong answer source:** random words from the user's own dictionary (same language)
- **Quiz scope:** launch from dictionary or from a specific topic
- **SRS impact:** quiz result does **not** affect SRS card interval in this release (separate session)
- **Direction:** user selects direction before starting (e.g. EN → RU or RU → EN)

#### Milestone 2.2 — SRS-Powered Notifications

- SRS-type notifications: send a word due for review according to SM-2 schedule
- Fallback: if no cards are due today → send AI-suggested word instead
- Re-engagement: if user is inactive for 14 days → pause notifications + send re-engagement message

---

### Milestone 3.0 — Topic Learning 🔭 (Planned)

**Theme:** Curated and AI-generated word sets for structured learning.

**Dependencies:** Dictionary (Milestone 1.0) for "save word from topic."

#### Milestone 3.0 — Ready-Made Topic Sets

- Built-in topics: Food, Travel, IT Terms, Basic Phrases (JSON/CSV datasets)
- Topic browsing via bot menu
- Translations generated on first open (AI batch)
- Shared translation cache: translations shared across users with same language pair set
- Cache invalidation on AI model change
- User selects which words to save to personal dictionary

#### Milestone 3.1 — AI-Generated Topics

- User requests "generate 20 words on topic: Sport" → AI returns word list
- Same shared-cache model as ready-made topics
- Save words from generated topic to dictionary

---

### Milestone 4+ — Platform Expansion ❄️ (Long-term)

**Theme:** Beyond Telegram. Richer media. Social features.

| Feature                           | Why Deferred                             |
| --------------------------------- | ---------------------------------------- |
| Audio pronunciation               | Telegram is a poor fit. Native app only. |
| Native mobile app (iOS/Android)   | Post-Telegram platform.                  |
| Camera scanning / OCR             | Native app only.                         |
| Shared / crowdsourced dictionary  | Social features — need user base first.  |
| AI Writer / paraphrasing          | Different product direction.             |
| Verb conjugation tables           | Large separate module. Not MVP.          |
| Monetization (freemium/paid plan) | TBD — after 100+ active users.           |

---

## 8. Out of Scope

| Feature                          | Reason                                      |
| -------------------------------- | ------------------------------------------- |
| Audio / pronunciation            | Telegram is a poor fit; defer to native app |
| Verb conjugation tables          | Separate large module, not MVP              |
| Camera scanning (OCR)            | Native app only                             |
| Shared / crowdsourced dictionary | Social features — not MVP                   |
| AI Writer / paraphrasing         | Different product                           |
| Native mobile app                | Post-MVP platform                           |

---

## 9. UX: Card & Action Buttons

### Card Data Fields

| Field                              | Example                                          | Source             |
| ---------------------------------- | ------------------------------------------------ | ------------------ |
| Word / phrase                      | `Hippokratovo slovo`                             | AI                 |
| Language + CEFR level              | `Czech, B1`                                      | AI                 |
| Transcription                      | `[ˈhɪpokratovo ˈslovo]`                          | AI                 |
| Translation (native language)      | `Hippocratic Oath`                               | AI / user override |
| Example sentence (target language) | `Hippokratova přísaha obsahuje důležitá slova.`  | AI                 |
| Example sentence (native language) | `The Hippocratic Oath contains important words.` | AI                 |

### Where Cards Are Shown

Cards appear in **all** of the following contexts:

- SRS review sessions (Milestone 2.0)
- Flash card sessions (Milestone 1.0 ✅)
- Notifications (word of the day / AI-suggested word) (Milestone 1.0 ✅)
- Dictionary browsing (Milestone 1.0 ✅)
- Topic word browsing (Milestone 3.0)

### Action Buttons

### ➕ Save to dictionary ✅

- Saves word or phrase to personal dictionary
- **Shown only** for `word` and `phrase` input types — never shown for `sentence`
- Button label is input-type aware: "💾 Save word" for words, "💾 Save phrase" for phrases
- If already saved: tap shows "Already in dictionary" notification (no duplicate created)
- After save: Save/Skip buttons replaced by regen-only keyboard; confirmation shown in message
- Does **not** add to SRS queue at this stage — SRS integration is Milestone 2.0

### 🎲 Next idea

- Shows the next AI-suggested word without saving current
- Relevant in notifications and topic browsing

### ❌ Don't suggest

- Marks word as "not interested" — excluded from personal AI suggestions and notifications
- Does **not** remove word from shared topic database
- Stored as a per-user ignore list

### ✨ Next translation ✅ (Resolved)

- **Status: Resolved** — The button is redundant because persistent translate mode (Task 09) already handles continuous translation. In translate mode, every message is automatically treated as a word to translate. The button remains in the layout as a UX alias: tapping it keeps the user in translate mode and prompts for the next word.

### ↔️ Flip

- Switches card direction: target → native becomes native → target
- Applies **everywhere** a card is shown
- Does **not** affect SRS interval
- State is **not** persisted between sessions (card always opens in default direction)

### ✏️ Edit translation

- Allows user to manually override the AI-generated translation
- Available only for words saved in personal dictionary
- Override stored in user profile, does not affect shared cache
- **Open question #2:** edit translation field only, or also example sentences?

### 🔊 Listen to example

- **Not included in MVP** — deferred to native app
- Noted here as it appears in competitor UI (MemoWords-style bots)

### Button Layout (Translate Mode)

```
[ 💾 Save word / 💾 Save phrase ]  ← word/phrase only
[ 🔄 Skip        ] [ 🔄 Next ]
[ 🇷🇺 EN ▼       ]                  ← source language selector
```

```
[ 🔄 CS ] [ 🔄 EN ] [ 🔄 DE ]       ← post-save (regen only)
[ 🇷🇺 EN ▼ ]                        ← source language selector
```

---

## 10. AI Integration

| Task                                                        | Approach                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Translation + synonyms + examples + emoji + CEFR + register | AI model via OpenRouter adapter, single request        |
| AI topic generation on user request                         | AI model, same provider                                |
| Translation of topic dataset words                          | Batch on first topic open, cached in DB (shared cache) |
| AI-suggested word for notification                          | AI model, 1 request per user per day                   |

### AI Response Schema (per target language)

```json
{
  "language": "Czech",
  "cefr_level": "B1",
  "translation": "Hippokratovo slovo",
  "emoji": "🩺",
  "transcription": "[ˈhɪpokratovo ˈslovo]",
  "register": "neutral",
  "synonyms": [{ "word": "lékařský slib", "register": "professional" }],
  "examples": [
    {
      "context": "formal",
      "target": "Hippokratova přísaha obsahuje důležitá slova.",
      "native": "The Hippocratic Oath contains important words."
    }
  ]
}
```

### Architecture

> AI provider: OpenRouter with model fallback. Architecture is built on the **adapter pattern**: swapping models requires no refactoring of business logic.

### Rate Limiting & Cost Control

- Maximum N translation requests per user per day (N = TBD based on cost model)
- AI-suggested word for notification: 1 request per active user per day (batch job)
- Topic dataset translations: generated once, shared cache, not regenerated per user

---

## 11. User Account & Profile Management

### Identification

Users are identified by `telegram_user_id`. No separate account system in MVP.

### User Lifecycle

| Stage                      | Action                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| First start                | Onboarding (3 steps) → profile created                                                                 |
| Active use                 | Translation, dictionary, flashcards, notifications                                                     |
| Settings change            | `/settings` command: change native language, add/remove target language, notification preferences      |
| Removing a target language | SRS cards for that language are **archived**, not deleted. User can restore by re-adding the language. |
| Inactivity (14 days)       | Notifications paused, re-engagement message sent                                                       |
| Account deletion           | `/delete` command → all user data deleted (GDPR compliance)                                            |

### Profile Settings

- Native language
- Target languages (1–4)
- Notification time (morning / evening)
- Notification type (SRS word / AI word / both)
- Interface language (UI language)
- Timezone (set explicitly)

---

## 12. Non-Functional Requirements

| Requirement               | Target                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| Time to first translation | < 10 seconds from bot start                                              |
| AI response timeout       | 15 seconds; on timeout → retry once, then show error message             |
| AI error fallback         | User-facing message: "Translation temporarily unavailable. Try again."   |
| Data storage region       | TBD (must comply with GDPR if EU users are targeted)                     |
| GDPR compliance           | Right to deletion (/delete), no data sharing with third parties          |
| Cache invalidation        | Topic cache flagged stale on AI model change; regenerated on next access |
| Max languages per user    | 4 (product decision, not technical limit)                                |
| Bot availability          | 99.5% uptime target                                                      |

---

## 13. Success Metrics

| Metric                         | Target                                       |
| ------------------------------ | -------------------------------------------- |
| Time to first translation      | < 10 sec after bot start                     |
| Onboarding completion rate     | > 70% reach Step 3                           |
| Retention Day 1                | User returns for review the next day         |
| Retention Day 7                | User active on Day 7                         |
| Retention Day 30               | User active on Day 30                        |
| Activation depth               | User saves 10+ words                         |
| Flash card engagement          | User completes at least 1 flash card session |
| Notification open rate         | > 30% (Telegram push benchmark)              |
| Translations per user (weekly) | TBD after first 100 users                    |

---

## 14. Open Questions & TBD

| #   | Question                                                                                                                                              | Blocks                                 | Priority     | Status                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------ | ------------------------------------------------- |
| 1   | ~~What does "Next translation" button do?~~ **Resolved:** Persistent translate mode handles continuous translation. The button remains as a UX alias. | ~~Topic and notification development~~ | ✅ Resolved  | Resolved                                          |
| 2   | Does "Edit translation" allow editing example sentences too?                                                                                          | Dictionary Polish (Milestone 1.1)      | 🟡 Important | **Open**                                          |
| 3   | Is "Flip" state persisted between sessions?                                                                                                           | SRS (Milestone 2.0)                    | 🟡 Important | **Open**                                          |
| 4   | Should "Next idea" and "Don't suggest" appear on SRS cards?                                                                                           | SRS (Milestone 2.0)                    | 🟡 Important | **Open**                                          |
| 5   | AI provider selection (OpenAI / Anthropic / Gemini / other)                                                                                           | All AI features                        | 🔴 Critical  | ✅ **Resolved: OpenRouter**                       |
| 6   | Rate limit N — max translation requests per user per day                                                                                              | Cost model                             | 🔴 Critical  | **Open**                                          |
| 7   | Monetization model (free / freemium / paid)                                                                                                           | Rate limits, roadmap                   | 🔴 Critical  | **Open**                                          |
| 8   | Data storage region — EU compliance required?                                                                                                         | Infrastructure                         | 🔴 Critical  | **Open**                                          |
| 9   | Quiz result impact on SRS interval in v2?                                                                                                             | Quizzes (Milestone 2.1)                | 🟠 Medium    | **Open**                                          |
| 10  | Maximum overdue cards shown per SRS session (suggested: 20)                                                                                           | SRS (Milestone 2.0)                    | 🟡 Important | **Open**                                          |
| 11  | ~~[FEAT-30/C1]~~ Breaking DB migration for `sourceLang → sourceLangId` FK                                                                             | ~~FEAT-30~~                            | 🔴 Critical  | ✅ **Resolved: YES**                              |
| 12  | ~~[FEAT-30/C2]~~ Target lang FK via junction table?                                                                                                   | ~~FEAT-30~~                            | 🟠 Medium    | ✅ **Resolved: Option B (JSONB key validation)**  |
| 13  | ~~[FEAT-30/C3]~~ Duplicate save behavior?                                                                                                             | ~~FEAT-30~~                            | 🟡 Important | ✅ **Resolved: Option A ("Already saved" toast)** |
| 14  | ~~[FEAT-30/C4]~~ Phrase card different layout?                                                                                                        | ~~FEAT-30~~                            | 🟡 Important | ✅ **Resolved: Button label only**                |
| 15  | ~~[FEAT-30/C5]~~ Post-save regen behavior?                                                                                                            | ~~FEAT-30~~                            | 🟡 Important | ✅ **Resolved: Option A (auto-update silently)**  |
| 16  | ~~[FEAT-30/C6]~~ Default existing entries to `inputType = 'word'`?                                                                                    | ~~FEAT-30~~                            | 🟠 Medium    | ✅ **Resolved: YES**                              |

---

## Appendix: Feature Status Summary

| Feature                       | Milestone | Status       |
| ----------------------------- | --------- | ------------ |
| Core translation pipeline     | 0         | ✅ Complete  |
| Persistent translate mode     | 0         | ✅ Complete  |
| Input type detection          | 0         | ✅ Complete  |
| Wiktionary context enrichment | 0         | ✅ Complete  |
| Auto-detect input language    | 0         | ✅ Complete  |
| Language source selector      | 0         | ✅ Complete  |
| User translation templates    | 0         | ✅ Complete  |
| Save to Dictionary (FEAT-30)  | 1.0       | ✅ Complete  |
| Dictionary Browse & Delete    | 1.0       | ✅ Complete  |
| Flash Cards                   | 1.0       | ✅ Complete  |
| Daily Word Notifications      | 1.0       | ✅ Complete  |
| /settings command             | 1.0       | ✅ Complete  |
| Edit saved translation        | 1.1       | 🔭 Planned   |
| Filter dictionary             | 1.1       | 🔭 Planned   |
| Spaced Repetition (SRS)       | 2.0       | 🔭 Planned   |
| Quizzes                       | 2.1       | 🔭 Planned   |
| SRS-powered notifications     | 2.2       | 🔭 Planned   |
| Ready-made topic sets         | 3.0       | 🔭 Planned   |
| AI-generated topics           | 3.1       | 🔭 Planned   |
| Audio pronunciation           | 4+        | ❄️ Long-term |
| Native mobile app             | 4+        | ❄️ Long-term |
