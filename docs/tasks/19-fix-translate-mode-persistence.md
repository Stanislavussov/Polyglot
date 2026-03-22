# Task 19: Fix Translate Mode Loss — Always-On Translation

**Status:** ✅ Done  
**Type:** 🐛 Bug Fix

## Description

Users intermittently lose translate mode: they send a word expecting translation, but the bot silently ignores the message — no translation card, no error, no logs. The message vanishes into the void. The user has to manually send `/translate` again to re-enter translate mode.

**User expectation:** After onboarding is complete, the bot should always translate any plain text message without requiring the user to enter a special mode, select a menu option, or run a command first. Translation is the core function — it should Just Work™.

---

## Root Cause Analysis

Multiple compounding issues cause translate mode to silently drop:

### 1. Default mode is `"idle"`, not `"translate"`

In `apps/bot/src/index.ts`, the session initializer sets `activeMode: "idle"`:

```typescript
initial: (): SessionData => ({
  activeMode: "idle",  // ← user must manually /translate first
  ...
})
```

A new or returning user who hasn't sent `/translate` in the current session has their text messages silently swallowed by the mode router's `idle` branch, which just calls `next()` — no feedback, no translation, no logs.

### 2. In-memory session storage — mode lost on restart

grammY's `session()` with no `storage` option uses **in-memory storage**. Every bot restart (deploy, crash, dyno cycle) wipes all sessions. After restart:
- `activeMode` resets to `"idle"` for every user
- Users who were mid-translation get no feedback
- `nextSourceLang` (Task 17) is also lost (by design, but compounds the confusion)

### 3. Onboarding doesn't activate translate mode

`apps/bot/src/scenes/onboarding.scene.ts` completes without setting `activeMode = "translate"`. A freshly onboarded user's next text message is **not** translated — they must discover `/translate` on their own.

### 4. `/start` for returning users doesn't restore translate mode

`apps/bot/src/commands/start.ts` shows a welcome-back message but doesn't touch `activeMode`. After a bot restart, even if the user sends `/start`, they're still in `"idle"`.

### 5. Silent failure in idle mode

The mode router's `idle` case silently passes to `next()`:

```typescript
case "idle":
default:
  return next(); // ← message disappears, no hint, no log
```

No feedback tells the user they need to activate translate mode. From the user's perspective, the bot is broken.

---

## Proposed Fix

### Core principle: **Translate mode is always on for onboarded users**

Translation is the primary function of the bot. An onboarded user sending plain text should **always** get a translation. There's no reason for `"idle"` mode to silently discard messages.

---

## Subtasks

### Step 1: Change default session mode to `"translate"`

- [x] In `apps/bot/src/index.ts`:
  - Change session initializer: `activeMode: "translate"` (was `"idle"`)
  - This ensures every new/restarted session starts in translate mode

### Step 2: Activate translate mode after onboarding

- [x] In `apps/bot/src/scenes/onboarding.scene.ts`:
  - After onboarding completes successfully, set `ctx.session.activeMode = "translate"`
  - This ensures freshly onboarded users can immediately send words

### Step 3: Activate translate mode on `/start` for onboarded users

- [x] In `apps/bot/src/commands/start.ts`:
  - For onboarded users (returning after restart), set `ctx.session.activeMode = "translate"`
  - This recovers mode after bot restart when user sends `/start`

### Step 4: Make idle mode fall back to translation

- [x] In `apps/bot/src/middlewares/mode-router.ts`:
  - Change `idle` / `default` case: instead of silently calling `next()`, treat it as translate mode
  - If user is onboarded → translate the message (same as `"translate"` case)
  - If user is NOT onboarded → reply with a hint to run `/start`
  - This is the safety net — even if mode is somehow `"idle"`, translation still works

### Step 5: Add debug logging for mode routing

- [x] In `apps/bot/src/middlewares/mode-router.ts`:
  - Log at `debug` level when routing a message: `{ mode, text: text.slice(0, 30), userId }`
  - Log a `warn` when a text message hits idle mode for an onboarded user (should never happen after fix)
  - This ensures future mode-loss issues are diagnosable from server logs

### Step 6: Update tests

- [x] Update existing mode router tests (if any) to reflect new default behavior
- [x] Add test: new session starts with `activeMode: "translate"`
- [x] Add test: idle mode for onboarded user falls back to translation
- [x] Add test: idle mode for non-onboarded user shows hint
- [x] Add test: `/start` sets `activeMode = "translate"` for onboarded user
- [x] Add test: onboarding completion sets `activeMode = "translate"`
- [x] All new and existing tests pass: `pnpm test`

---

## Architecture Constraints

| Package          | Change scope                                    | Notes                                |
| ---------------- | ----------------------------------------------- | ------------------------------------ |
| `apps/bot/`      | Session default, mode router, onboarding, start | All changes in bot layer             |
| `packages/core/` | No changes                                      |                                      |
| `packages/adapters/*` | No changes                                 |                                      |

No DB changes. No i18n changes (existing keys sufficient). Pure bot-layer fix.

---

## Edge Cases

| Scenario                                    | Behavior after fix                                             |
| ------------------------------------------- | -------------------------------------------------------------- |
| Bot restart, user sends text immediately    | Session inits with `activeMode: "translate"` → word is translated |
| Fresh onboarding → user sends first word    | Onboarding sets `activeMode = "translate"` → word is translated  |
| User sends `/start` after restart           | `/start` sets `activeMode = "translate"` → next word translated  |
| Non-onboarded user sends text (no `/start`) | Mode router detects not onboarded → replies with `/start` hint   |
| Future modes (e.g., `"mentor"`)             | Mode router still supports explicit mode switching via commands   |

---

## Key Risks & Mitigations

| Risk                                          | Mitigation                                                            |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Breaking future mode system (`"mentor"`, etc) | Mode switch commands still work — only the default/fallback changes   |
| Non-onboarded users getting translation errors | Check `user.onboarded` before translating in idle fallback            |
| Conversations plugin intercepting updates     | Translate mode is middleware-based, not conversation-based — no conflict |

---

## Acceptance Criteria

- [x] Default session `activeMode` is `"translate"` (not `"idle"`)
- [x] After onboarding, user can immediately send a word and get a translation without `/translate`
- [x] After bot restart, user can send a word and get a translation without `/translate`
- [x] No plain text message from an onboarded user is silently ignored
- [x] Debug logging shows mode routing decisions in server logs
- [x] All new and existing tests pass: `pnpm test`
- [x] All packages build: `pnpm -r run build`
