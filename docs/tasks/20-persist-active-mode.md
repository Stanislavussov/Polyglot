# Task 20: Persist activeMode in the Database

**Status:** ✅ Done  
**Type:** ✨ Feature

## Description

Persist the user's active mode (`activeMode`) in the `userLanguageSettings` table so it survives bot restarts. Previously, `activeMode` was session-only — stored in grammY's in-memory session, lost on every bot restart. Now the DB is the source of truth, and the session is hydrated from it on each request.

This prepares for upcoming "mentor" and "quiz" modes, which will be added to the `UserMode` type and the DB column.

## Changes

### DB Layer (done by db agent)
- Added `activeMode` column to `userLanguageSettings` table (text, default 'translate', NOT NULL)
- Created idempotent migration `0003_active_mode.sql`
- Added `userRepository.updateActiveMode(userId, mode)` method
- Updated `updateSettings` upsert to include `activeMode` in conflict set

### Bot Layer
- **auth.ts**: Loads settings for onboarded users, hydrates `ctx.session.activeMode` from DB value. Falls back to `"translate"` for unknown mode values (forward-compatible with future modes).
- **start.ts**: `/start` now calls `userRepository.updateActiveMode()` alongside setting session
- **translate.scene.ts**: `/translate` now persists mode to DB
- **onboarding.scene.ts**: Post-onboarding `activeMode = "translate"` persisted to DB via `conversation.external()`
- **mode-router.ts**: Idle→translate fallback now persists to DB
- **types.ts**: Updated `UserMode` JSDoc to note DB persistence

## Subtasks

- [x] DB schema: Add `active_mode` column to `userLanguageSettings`
- [x] DB migration: `0003_active_mode.sql` (idempotent)
- [x] DB repository: `updateActiveMode(userId, mode)` method
- [x] DB repository: `updateSettings` upsert includes `activeMode`
- [x] Bot auth: Hydrate session from DB on every request
- [x] Bot /start: Persist mode change to DB
- [x] Bot /translate: Persist mode change to DB
- [x] Bot onboarding: Persist mode after completion
- [x] Bot mode-router: Persist idle→translate fallback
- [x] Tests: auth middleware (7 tests), start command (4 tests), translate scene (3 tests), onboarding (+1 test), mode router (+1 test)
- [x] All 774 tests pass

## Files Created/Modified

| File | Action |
|------|--------|
| `packages/adapters/db/src/schema.ts` | Modified — added `activeMode` column |
| `packages/adapters/db/drizzle/0003_active_mode.sql` | Created — migration |
| `packages/adapters/db/src/repositories/user.repository.ts` | Modified — `updateActiveMode`, upsert update |
| `packages/adapters/db/src/__tests__/user.repository.test.ts` | Created — 14 tests |
| `apps/bot/src/middlewares/auth.ts` | Modified — hydrate activeMode from DB |
| `apps/bot/src/middlewares/auth.test.ts` | Created — 7 tests |
| `apps/bot/src/commands/start.ts` | Modified — persist to DB |
| `apps/bot/src/commands/start.test.ts` | Modified — added DB persistence test |
| `apps/bot/src/scenes/translate.scene.ts` | Modified — persist to DB |
| `apps/bot/src/scenes/translate.scene.test.ts` | Created — 3 tests |
| `apps/bot/src/scenes/onboarding.scene.ts` | Modified — persist to DB |
| `apps/bot/src/__tests__/onboarding.scene.test.ts` | Modified — added DB persistence test |
| `apps/bot/src/middlewares/mode-router.ts` | Modified — persist idle→translate fallback |
| `apps/bot/src/__tests__/translate-mode.test.ts` | Modified — added DB persistence test |
| `apps/bot/src/types.ts` | Modified — updated JSDoc |

## Architecture

```
Session (grammY in-memory)         DB (userLanguageSettings.activeMode)
┌─────────────────────┐            ┌─────────────────────────────────┐
│ ctx.session.activeMode │ ← hydrated from │ activeMode TEXT DEFAULT 'translate' │
│ (per-request cache)    │            │ (source of truth)                  │
└─────────────────────┘            └─────────────────────────────────┘
        ↓ written on mode change           ↑ written on mode change
        └──────────────────────────────────┘
```

- **Read path**: Auth middleware loads settings → hydrates session from DB → all handlers read session
- **Write path**: Every mode change writes to both session AND DB simultaneously
- **Validation**: Auth middleware validates DB value against known modes, falls back to "translate"
