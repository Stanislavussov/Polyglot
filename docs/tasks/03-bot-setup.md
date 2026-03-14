# Task 03: First step on bot creation

**Status:** ⬜ Not done

## Description

Set up the grammY Telegram bot in `apps/bot/`, wire it to the DB adapter, implement the `/start` command that triggers the onboarding flow (4 steps) as described in `tech-reqs/09-onboarding.md` and `tech-reqs/10-bot-commands.md`.

## Subtasks

- [ ] Install dependencies in `@polyglot/bot`: `grammy` 1.x, cross-workspace deps (`@polyglot/core`, `@polyglot/adapter-db`)
- [ ] Create `apps/bot/index.ts` — bot initialization:
  - Read `BOT_TOKEN` from env (via `shared/config.ts`)
  - Initialize DB connection (`getDb()`)
  - Create grammY `Bot` instance
  - Register middleware and commands
  - Start long-polling (`bot.start()`)
- [ ] Create `apps/bot/middlewares/auth.ts` — middleware that:
  - Extracts `telegramId` from update
  - Calls `userRepository.findByTelegramId()` — creates user if not found
  - Attaches user to context (`ctx.user`)
- [ ] Create `apps/bot/scenes/onboarding.scene.ts` — 4-step onboarding:
  - **Step 1:** "Which language to continue in?" — inline keyboard with language flags (🇷🇺 Russian | 🇬🇧 English | 🇨🇿 Čeština), saves `interfaceLang`
  - **Step 2:** "What is your native language?" — inline keyboard, saves `nativeLang`
  - **Step 3:** "Which languages are you learning?" — multi-select inline keyboard (1–4 languages), ✅ Done button, saves `learningLangs`
  - **Step 4:** Demo translation — user enters any word, bot shows placeholder result (AI not wired yet), "Save to dictionary?" → [Yes] [No], marks `onboarded = true`
- [ ] Create `apps/bot/commands/start.ts` — `/start` handler:
  - If user not onboarded → enter onboarding scene
  - If user onboarded → show main menu
- [ ] Set up bot commands list via `bot.api.setMyCommands()` per `tech-reqs/10-bot-commands.md`
- [ ] Add graceful shutdown (SIGINT/SIGTERM → `bot.stop()`)
- [ ] Add `dev` script in `apps/bot/package.json` (`tsx watch src/index.ts` or similar)
- [ ] Test manually: `/start` → complete all 4 onboarding steps → user saved in DB

## Acceptance criteria

- Bot starts and connects to Telegram (long-polling, no webhooks)
- `/start` triggers the onboarding flow for new users
- All 4 onboarding steps work with inline keyboards
- User record + language settings are saved to PostgreSQL after onboarding
- Returning users (already onboarded) see the main menu instead of onboarding
- Bot shuts down gracefully on SIGINT
