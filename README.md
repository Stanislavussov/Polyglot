# Polyglot

**Learn multiple languages simultaneously — one word at a time.**

## The Problem

People who learn 2+ foreign languages in parallel face a gap no existing tool fills: you know a word in one language but forget it in another. Traditional language apps work in a single language pair — you must search the same word separately in each tool.

## What Polyglot Does

Polyglot is a **Telegram bot** that lets you enter any word, phrase, or sentence and receive translations for **all your target languages at once** — each enriched with CEFR level, word register, synonyms, transcription, and contextual examples.

### Core Features

- **Multi-language translation** — one input, all target languages returned simultaneously
- **Personal dictionary** — save words with a single tap, build your vocabulary
- **Flash card review** — study your saved words at your own pace
- **Daily reminders** — scheduled notifications keep vocabulary fresh
- **Spaced repetition (planned)** — SM-2 algorithm surfaces words right before you forget them
- **Topic-based learning (planned)** — curated and AI-generated vocabulary sets

### What Sets It Apart

| Feature | Why It Matters |
|---------|---------------|
| Multi-language in one request | No more searching the same word across 3 different tools |
| Word register (slang / formal / neutral) | Know *when* to use a word, not just *what* it means |
| CEFR level on every card | Track difficulty at a glance |
| Shared translation cache | Community benefits from each other's learning |

## Architecture

Polyglot is a **TypeScript monorepo** built with clean adapter boundaries:

```
apps/bot          — Telegram bot (grammY)
packages/core     — Domain logic, i18n, topics
packages/adapters/
  db              — PostgreSQL via Drizzle ORM
  ai              — AI translation providers
  notifications   — Scheduled notification delivery
packages/infra    — Logging, config, DI container
```

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill in your API keys
pnpm db:push           # set up the database
pnpm bot               # start the bot in dev mode
```

### Quality Gate

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

## Roadmap

| Milestone | Theme | Status |
|-----------|-------|--------|
| **0** | Foundation — core translation engine | ✅ Complete |
| **1.0** | Personal dictionary — save, browse, review | ✅ Complete |
| **1.1** | Dictionary polish — edit, filter, search | Planned |
| **2.0** | Learning engine — SRS, quizzes, smart notifications | Planned |
| **3.0** | Topic learning — curated & AI-generated word sets | Planned |
| **4+** | Beyond Telegram — audio, native app, social | Long-term |

## Tech Stack

- **Runtime**: Node.js, TypeScript
- **Bot framework**: grammY (Telegram)
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: LLM-based translation pipeline
- **Testing**: Vitest
- **Linting**: Biome + dependency-cruiser
- **Package manager**: pnpm workspaces
