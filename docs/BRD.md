/# Polyglot — Business Requirements Document (BRD)

---

## 1. Problem Statement

A person speaks their native language and is simultaneously learning 2+ foreign languages. When studying new vocabulary, a recurring problem arises: they know a word in one language but forget it in another. Existing tools do not solve this:

- **Duolingo, Anki**, — work in a single native → target language pair
- **Reverso, DeepL** — provide excellent context but only for one language pair at a time
- **Lexicorn** - telegram bot providing similar services

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

### 6.1 Word / Phrase Translation

The user enters anything — a word, phrase, idiom, or fixed expression. The AI returns one message per target language containing:

| Field             | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| Translation       | With auto-assigned emoji                                                    |
| CEFR level        | A1–C2, determined by AI per language                                        |
| Transcription     | Where applicable (e.g. Czech, Japanese)                                     |
| Word register     | Slang / colloquial / neutral / literary / professional                      |
| Synonyms          | With their respective register labels                                       |
| Example sentences | 2–3 sentences covering different contexts: formal, colloquial, professional |

**Save flow:** one-button save directly from the translation result. Available for **word** and **phrase** input types only — sentence translations cannot be saved to dictionary.
- Save button label reflects input type: "💾 Save word" or "💾 Save phrase"
- Content stored: emoji, register, per-language translations (text, CEFR, transcription, register, synonyms, examples, alternatives, expression type) — internal pipeline fields are excluded
- Source language stored as FK to `languages` table (not plain text)
- Input type stored as dedicated column for future SRS/quiz differentiation
- Duplicate detection: tapping Save on an already-saved word shows "Already in dictionary" instead of creating a duplicate entry
- After save: Save/Skip buttons replaced by regen-only keyboard, allowing translation refinement of the saved entry
- See detailed requirements: `docs/requirements/30-save-to-dictionary.md` (FEAT-30)

---

## 7. Post-MVP (v2)

| Feature                       | Inspiration              | Why deferred                           |
| ----------------------------- | ------------------------ | -------------------------------------- |
| Personal Dictionary (Save flow) | —                      | ✅ Save mechanism: **In Design** (FEAT-30) — browse, search, edit deferred |
| Ready-Made Topic Sets         | —                        | Content curation and cache infra       |
| Spaced Repetition (SRS)       | —                        | Complex scheduling logic               |
| Quizzes                       | —                        | Depends on dictionary and SRS          |
| Notifications (Telegram Push) | —                        | Depends on SRS and AI-suggestion flow  |
| Search history                | Reverso                  | Convenient but not critical for v1     |
| Multiple word lists           | Reverso Vocabulary Lists | Needs user base first                  |
| Streaks and daily goals       | Duolingo / Reverso       | Motivation layer, not core             |
| Filter by part of speech      | Reverso Context          | Translation complexity, skip for MVP   |
| Word definition (Define Mode) | Reverso                  | Useful, not urgent                     |
| Word frequency in language    | Reverso                  | Interesting, not MVP                   |
| Audio pronunciation           | —                        | Poor Telegram fit, defer to native app |

### Post-MVP 2.1 Personal Dictionary

**Save mechanism (FEAT-30) — In Design.** The core save flow (inline button → dictionary entry) is being actively designed. Full requirements: `docs/requirements/30-save-to-dictionary.md`.

**What is being implemented now (FEAT-30):**
- Save words/phrases directly from translation results via one-tap inline button
- Each word stored with: original text, source language (FK to `languages` table), input type (`word`|`phrase`), full sanitized translation content (JSONB)
- Duplicate detection: second save of same word shows "Already in dictionary" instead of creating duplicate
- Post-save keyboard: regen buttons remain active so users can refine translations after saving

**Deferred to v2 (not in FEAT-30):**
- Browse and search saved dictionary (`/dictionary` command)
- **Edit translation:** user can manually correct AI-generated translation for any saved word. The edit is stored in the user's profile and does **not** affect the shared translation cache.
- Save to specific topic/collection
- SRS scheduling triggered on save

**Open question:** does "Edit translation" allow editing example sentences as well, or only the translation field? → See [Section 14](#14-open-questions--tbd)

---

### Post-MVP 2.2 Ready-Made Topic Sets

- Built-in topics: "Food", "Travel", "IT Terms", "Basic Phrases", etc. (stored as JSON/CSV datasets)
- **AI-generated topics:** user requests "generate 20 words on the topic Sport" → AI returns a word list
- On topic open: translations are generated via AI for the user's specific language set
- **Shared cache:** translations for topic words are cached in DB and shared across users with the same language pair set — not regenerated per user
- **Cache invalidation:** if AI model changes, cached translations are flagged as stale and regenerated on next access
- User selects which words to save to personal dictionary

---

### Post-MVP 2.3 Spaced Repetition (SRS)

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

---

### Post-MVP 2.4 Quizzes

- **Question format:** show a word in one language → user inputs or selects translation in another language
- **Modes:** multiple choice (4 options) / free text input
- **Wrong answer source:** random words from the user's own dictionary (same language)
- **Quiz scope:** launch from dictionary or from a specific topic
- **SRS impact:** quiz result does **not** affect SRS card interval in MVP (separate session)
- **Direction:** user selects direction before starting (e.g. EN → RU or RU → EN)

---

### Post-MVP 2.5 Notifications (Telegram Push)

- **Frequency:** 1 notification per day
- **Timing:** user selects morning or evening
- **Timezone:** collected explicitly during onboarding or profile setup (not inferred from Telegram — Telegram does not expose user timezone)
- **Types (user selects one or both):**

| Type                       | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| Word from dictionary (SRS) | A word due for review according to SRS schedule        |
| AI-suggested word          | A new word selected by AI based on user's saved topics |

- **Notification content:** word + translation on all user languages + CEFR level
- **Actions from notification:** "Save to dictionary" / "Skip"
- **Fallback:** if SRS type is selected but no cards are due today → send AI-suggested word instead (with note)
- **Pause:** if user has not interacted with the bot for 14 days → notifications paused, user receives a re-engagement message

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

---

### Where Cards Are Shown

Cards appear in **all** of the following contexts:

- SRS review sessions
- Notifications (word of the day / AI-suggested word)
- Dictionary browsing
- Topic word browsing

---

### Action Buttons

### ➕ Save to dictionary

- Saves word or phrase to personal dictionary
- **Shown only** for `word` and `phrase` input types — never shown for `sentence` (per Task 27)
- Button label is input-type aware: "💾 Save word" for words, "💾 Save phrase" for phrases
- If already saved: tap shows "Already in dictionary" notification (no duplicate created)
- After save: Save/Skip buttons replaced by regen-only keyboard; confirmation shown in message
- Does **not** add to SRS queue at this stage — SRS integration is Post-MVP 2.3

### 🎲 Next idea

- Shows the next AI-suggested word without saving current
- Relevant in notifications and topic browsing

### ❌ Don't suggest

- Marks word as "not interested" — excluded from personal AI suggestions and notifications
- Does **not** remove word from shared topic database
- Stored as a per-user ignore list

### ✨ Next translation

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
- **Open question:** edit translation field only, or also example sentences?

### 🔊 Listen to example

- **Not included in MVP** — deferred to native app
- Noted here as it appears in competitor UI (MemoWords-style bots)

---

### Button Layout

```
[ ➕ Save to dictionary              ]
[ 🎲 Next idea      ] [ ❌ Don't suggest ]
[ ✨ Next translation                 ]
[ ↔️ Flip                             ]
[ ✏️ Edit translation                 ]
```

> "Save to dictionary" is hidden if word already saved.
> "Edit translation" is active only for saved dictionary words.
> "Listen to example" absent in MVP.

---

## 10. AI Integration

| Task                                                        | Approach                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Translation + synonyms + examples + emoji + CEFR + register | AI model (TBD), single request                         |
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

> AI provider — **TBD**. Architecture is built on the **adapter pattern**: swapping models requires no refactoring of business logic.

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
| Active use                 | Translation, dictionary, SRS, quizzes, notifications                                                   |
| Settings change            | /settings command: change native language, add/remove target language                                  |
| Removing a target language | SRS cards for that language are **archived**, not deleted. User can restore by re-adding the language. |
| Inactivity (14 days)       | Notifications paused, re-engagement message sent                                                       |
| Account deletion           | /delete command → all user data deleted (GDPR compliance)                                              |

### Profile Settings

- Native language
- Target languages (1–4)
- Notification time (morning / evening)
- Notification type (SRS word / AI word / both)
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

| Metric                         | Target                                  |
| ------------------------------ | --------------------------------------- |
| Time to first translation      | < 10 sec after bot start                |
| Onboarding completion rate     | > 70% reach Step 3                      |
| Retention Day 1                | User returns for review the next day    |
| Retention Day 7                | User active on Day 7                    |
| Retention Day 30               | User active on Day 30                   |
| Activation depth               | User saves 10+ words                    |
| Topic engagement               | At least 1 topic opened and words saved |
| SRS activation                 | User completes at least 1 SRS session   |
| Notification open rate         | > 30% (Telegram push benchmark)         |
| Translations per user (weekly) | TBD after first 100 users               |

---

## 14. Open Questions & TBD

| #   | Question                                                     | Blocks                             | Priority     |
| --- | ------------------------------------------------------------ | ---------------------------------- | ------------ |
| 1   | ~~What does "Next translation" button do?~~ **Resolved:** The button is redundant — persistent translate mode (Task 09) already handles continuous translation. The button remains in the layout as a UX alias that keeps the user in translate mode. | ~~Topic and notification development~~ | ✅ Resolved  |
| 2   | Does "Edit translation" allow editing example sentences too? | Dictionary development             | 🟡 Important |
| 3   | Is "Flip" state persisted between sessions?                  | SRS development                    | 🟡 Important |
| 4   | Should "Next idea" and "Don't suggest" appear on SRS cards?  | SRS development                    | 🟡 Important |
| 5   | AI provider selection (OpenAI / Anthropic / Gemini / other)  | All AI features                    | 🔴 Critical  |
| 6   | Rate limit N — max translation requests per user per day     | Cost model                         | 🔴 Critical  |
| 7   | Monetization model (free / freemium / paid)                  | Rate limits, roadmap               | 🔴 Critical  |
| 8   | Data storage region — EU compliance required?                | Infrastructure                     | 🔴 Critical  |
| 9   | Quiz result impact on SRS interval in v2?                    | v2 planning                        | 🟠 Medium    |
| 10  | Maximum overdue cards shown per SRS session (suggested: 20)  | SRS development                    | 🟡 Important |
| 11  | **[FEAT-30/C1]** Is a breaking DB migration for `sourceLang → sourceLangId` FK acceptable? Need backfill strategy. | FEAT-30 DB migration | 🔴 Critical |
| 12  | **[FEAT-30/C2]** Add `word_target_langs` junction table for target language FK integrity (Option A), or validate JSONB keys at write time (Option B)? | FEAT-30 architecture | 🟠 Medium |
| 13  | **[FEAT-30/C3]** Duplicate save: (A) show "Already saved" + stop (Reverso-style), or (B) silently update existing entry with latest translation? | FEAT-30 UX | 🟡 Important |
| 14  | **[FEAT-30/C4]** Should phrase card have different layout from word card (examples first, no synonyms), or just different button label? | FEAT-30 rendering | 🟡 Important |
| 15  | **[FEAT-30/C5]** Post-save regen: (A) auto-update saved entry silently, (B) revert to unsaved state, or (C) prompt to re-save? | FEAT-30 regen flow | 🟡 Important |
| 16  | **[FEAT-30/C6]** Is defaulting all pre-existing `words` entries to `inputType = 'word'` an acceptable approximation? | FEAT-30 migration | 🟠 Medium |
