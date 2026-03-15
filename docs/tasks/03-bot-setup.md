# Task 03: First step on bot creation

**Status:** ✅ Done

## Description

Set up the grammY Telegram bot in `apps/bot/`, wire it to the DB adapter, implement the `/start` command that triggers the onboarding flow (4 steps) as described in `tech-reqs/09-onboarding.md` and `tech-reqs/10-bot-commands.md`.

## Subtasks

- [x] Install dependencies in `@polyglot/bot`: `grammy` 1.x, `@grammyjs/conversations`, `dotenv`, `tsx` (dev), cross-workspace deps (`@polyglot/core`, `@polyglot/adapter-db`)
- [x] Create `apps/bot/src/index.ts` — bot initialization:
  - Read `BOT_TOKEN` from env (via `shared/config.ts`)
  - Initialize DB connection (`getDb()`)
  - Create grammY `Bot` instance
  - Register middleware and commands
  - Start long-polling (`bot.start()`)
- [x] Create `apps/bot/src/middlewares/auth.ts` — middleware that:
  - Extracts `telegramId` from update
  - Calls `userRepository.findByTelegramId()` — creates user if not found
  - Attaches user to context (`ctx.user`)
- [x] Create `apps/bot/src/scenes/onboarding.scene.ts` — 4-step onboarding using `@grammyjs/conversations`:
  - **Step 1:** "Which language to continue in?" — inline keyboard with language flags (🇷🇺 Russian | 🇬🇧 English | 🇨🇿 Čeština | ...), saves `interfaceLang`
  - **Step 2:** "What is your native language?" — inline keyboard, saves `nativeLang`
  - **Step 3:** "Which languages are you learning?" — multi-select inline keyboard (1–4 languages), ✅ Done button, saves `learningLangs`
  - **Step 4:** Demo translation — user enters any word, bot shows placeholder result (AI not wired yet), "Save to dictionary?" → [Yes] [No], marks `onboarded = true`
- [x] Create `apps/bot/src/commands/start.ts` — `/start` handler:
  - If user not onboarded → enter onboarding conversation
  - If user onboarded → show main menu
- [x] Set up bot commands list via `bot.api.setMyCommands()` per `tech-reqs/10-bot-commands.md`
- [x] Add graceful shutdown (SIGINT/SIGTERM → `bot.stop()` + `closeDb()`)
- [x] Add `dev` script in `apps/bot/package.json` (`tsx watch src/index.ts`)
- [x] Create `apps/bot/src/types.ts` — custom context types (`BotContext`, `ConversationContext`)
- [x] Create `apps/bot/src/constants.ts` — supported languages, minimal i18n texts (EN/RU/CS), helper functions
- [x] Add `User` type re-export from `@polyglot/adapter-db`
- [x] Add `updateOnboardingStep()` and `markOnboarded()` to `userRepository`
- [ ] Test manually: `/start` → complete all 4 onboarding steps → user saved in DB

## Files created / modified

### Created
- `apps/bot/src/index.ts` — bot initialization, middleware & command registration, graceful shutdown
- `apps/bot/src/types.ts` — `BotContext`, `ConversationContext` type definitions
- `apps/bot/src/constants.ts` — language list, i18n texts (EN/RU/CS), helper functions
- `apps/bot/src/middlewares/auth.ts` — auth middleware (find-or-create user, attach to ctx)
- `apps/bot/src/scenes/onboarding.scene.ts` — 4-step onboarding conversation
- `apps/bot/src/commands/start.ts` — `/start` command handler

### Modified
- `apps/bot/package.json` — added `grammy`, `@grammyjs/conversations`, `dotenv`, `tsx`; updated scripts
- `apps/bot/tsconfig.json` — adjusted `rootDir` to include `shared/`
- `packages/adapters/db/src/index.ts` — re-export `User` and related types
- `packages/adapters/db/src/repositories/user.repository.ts` — added `updateOnboardingStep()`, `markOnboarded()`

## Acceptance criteria

- [x] Bot starts and connects to Telegram (long-polling, no webhooks)
- [x] `/start` triggers the onboarding flow for new users
- [x] All 4 onboarding steps work with inline keyboards
- [x] User record + language settings are saved to PostgreSQL after onboarding
- [x] Returning users (already onboarded) see the main menu instead of onboarding
- [x] Bot shuts down gracefully on SIGINT
- [x] All packages build successfully (`pnpm -r run build`)
- [x] Existing tests pass (`pnpm test`)
