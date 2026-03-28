---
name: product
description: "Monitors competitors, analyzes their features, and proposes what to add to Polyglot. Use when evaluating competitor features, prioritizing new features, or generating competitive analysis reports."
---

# Product — Competitor Intelligence

Analyzes competitor features and proposes additions to Polyglot. Writes to `docs/research/competitors.md`.

## Key Competitors

**Direct:** Duolingo, Reverso Context, Anki, Babbel, Memrise, Busuu, Clozemaster
**Dictionaries:** DeepL, Google Translate, Linguee, WordReference, Collins, Cambridge, Multitran
**Flashcards:** Quizlet, Brainscape, Mochi, RemNote
**AI-native:** Speak, Langotalk, Elsa Speak, Gliglish, Khanmigo
**Telegram bots:** @LearnEnglishBot, @LinguaBot, @DailyEnglishBot, @FluentBot

## Rules

- Public features only (App Store, websites, changelogs)
- Never copy — draw inspiration, adapt to Polyglot's multilingual context
- Score every proposal by **impact × effort** — high impact + low effort first
- Mark features we already have as `alreadyHave: true`
- Social features (leaderboards, friends) → low priority for MVP

## Priority Matrix

```
            Low Effort   Med Effort   High Effort
High Impact  🔥 Do now    📋 Plan      🔭 Future
Med Impact   📋 Plan      🤔 Evaluate  ❄️ Skip
Low Impact   🤔 Evaluate  ❄️ Skip      ❌ No
```

## Output Path

`docs/research/competitors.md`
