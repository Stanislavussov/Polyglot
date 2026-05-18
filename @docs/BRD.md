# Polyglot — Business Requirements Document

> **Last updated:** 2026-05-16

---

## 1. Problem

A person speaks their native language and is learning 2+ foreign languages simultaneously. When studying new vocabulary, they know a word in one language but forget it in another. Existing tools only work in a single language pair — the user must search separately for each language.

**Polyglot solves this:** one word entered, translations returned for all target languages at once, saved together with usage context, and reviewed at the right moment.

---

## 2. Who It's For

- **Emigrants** — learning the language of a new country while maintaining a second foreign language
- **Polyglots** — actively studying 2+ languages in parallel
- **Multilingual professionals** — work, family, or relocation requiring multiple languages

---

## 3. Positioning

Polyglot is the only language-learning tool built for users learning **2+ languages simultaneously**. A single translation returns results for all target languages at once, enriched with CEFR level, word register, synonyms, and contextual examples.

### What sets Polyglot apart

| Feature | Why it matters |
|---------|---------------|
| Multi-language in one request | No more searching the same word in 3 different tools |
| Word register (slang / formal / neutral) | Know *when* to use a word, not just *what* it means |
| CEFR level on every card | Track difficulty at a glance |
| Shared translation cache | Community benefits from each other's learning |
| SRS-powered review | Words surface at the moment you're about to forget them |
| Topic-based learning | Structured vocabulary, not random words |

---

## 4. Platform

**Telegram Bot** — sole platform for the foreseeable future.

Zero installation barrier, built-in notifications, and keyboard-based interaction are sufficient for the entire planned feature set. Audio pronunciation and richer media are deferred until there's a case for a native app.

---

## 5. Onboarding

Three questions, then immediate value:

1. **What is your native language?**
2. **Which languages are you learning?** (up to 4)
3. **Try it now** — enter any word and see the result immediately

Step 3 is the "aha moment": the user sees the product working before they've even finished signing up.

---

## 6. What Polyglot Does

### Translate

Enter any word, phrase, or sentence. Get back translations for all your target languages in a single message — each with CEFR level, transcription, word register, synonyms, and example sentences.

Sentences get a compact translation. Words and phrases get the full card with save and review options.

### Save to Dictionary

One tap saves a word across all your languages. The system detects duplicates and lets you refine translations after saving.

### Review

Flash card sessions pull from your personal dictionary. You see the word, reveal translations, and move through the deck at your own pace.

### Daily Reminders

Scheduled notifications surface words from your dictionary — a daily review prompt that keeps vocabulary fresh without effort.

### Settings

Change your native language, add or remove target languages, adjust notification preferences, and set your interface language.

### Templates

Customize what appears on each translation card — toggle examples, synonyms, transcription, or CEFR level on or off to match your learning style.

---

## 7. Where We're Going

### Milestone 0 — Foundation ✅

Core translation engine works. Users can translate words and phrases across multiple languages with rich context.

### Milestone 1.0 — Personal Dictionary ✅

The save → review loop is complete. Users build a personal vocabulary, browse it, review it with flash cards, and get daily reminders.

### Milestone 1.1 — Dictionary Polish

Refinements: edit saved translations, filter dictionary by language or difficulty, case-insensitive search, search history.

### Milestone 2.0 — Spaced Repetition

The dictionary becomes an active learning tool. SM-2 algorithm schedules reviews at optimal intervals. Each target language is tracked separately. Overdue words surface in order of urgency.

### Milestone 2.1 — Quizzes

Test yourself with multiple-choice or free-text questions drawn from your own dictionary. Launch from any word set.

### Milestone 2.2 — SRS Notifications

Daily notifications shift from random suggestions to words that are actually due for review. If nothing is due, fall back to AI suggestions.

### Milestone 3.0 — Topic Sets

Curated vocabulary sets (Food, Travel, IT Terms) and AI-generated topic lists on demand. Browse, learn, and save words directly to your dictionary. Shared translation cache means the community benefits from each topic once.

### Milestone 4+ — Beyond Telegram

Audio pronunciation, native mobile app, social features — when the user base justifies it.

---

## 8. What We're Not Building (Yet)

| Feature | Why not now |
|---------|-------------|
| Audio pronunciation | Telegram is a poor fit for audio-first UX |
| Verb conjugation tables | Large separate module, different product |
| Camera scanning / OCR | Requires native app |
| Shared / crowdsourced dictionary | Need a user base first |
| Monetization | After 100+ active users, with real cost data |

---

## 9. Open Questions

| Question | Why it matters | Status |
|----------|---------------|--------|
| How many translations per user per day? | Cost control, abuse prevention | Open |
| Monetization model? | Free / freemium / paid | Open |
| Data storage region? | GDPR compliance for EU users | Open |
| Can users edit example sentences on saved words? | Scope of the edit feature | Open |
| Should SRS cards show "next idea" and "don't suggest"? | Notification behavior on review cards | Open |
| Quiz results affecting SRS intervals? | Integration between quiz and review systems | Open |

---

## 10. Success Looks Like

| Metric | Target |
|--------|--------|
| Onboarding completion | > 70% reach the demo translation |
| Day 1 retention | User returns the next day |
| Day 30 retention | User still active after a month |
| Activation depth | User saves 10+ words |
| Flash card engagement | At least one session completed |
| Notification open rate | > 30% |

---

## 11. Non-Functional

- First translation in under 10 seconds
- Graceful degradation when AI is unavailable
- GDPR-compliant: users can delete all their data
- 99.5% uptime target
- Maximum 4 target languages per user (product decision for readability)
