# Task 83 — Mentor idle-timeout prompt & explicit mode entity

**Status:** ✅ Done
**Branch:** `worktree/calm-forest-6dd9` (based on `origin/develop` @ `694df42`)
**Plan:** `.omc/plans/mentor-idle-timeout.md` (ralplan consensus, 4 iterations, approved)

## Request

In mentor mode, when the user sends the next message after a long pause,
ask whether they still want the mentor: two buttons, **stay in mentor mode**
or **switch to translation**. And make the set of modes (translate, mentor)
an explicit entity rather than a string scattered across the bot.

## Behaviour

- Idle window: **15 minutes** since the last mentor activity (entering
  `/mentor` or "New topic", or a completed mentor turn). Measured from the
  *completed* turn, so a slow AI answer never counts against the user.
- Past the window, a plain text message in mentor mode does **not** run a
  paid turn. The bot asks `mentorIdleQuestion` with two inline buttons and
  holds the message in `session.mentorIdlePrompt` (single slot; a newer
  message supersedes and the old prompt is deleted).
- **Stay** (`mentor:idle:stay`) → the held text runs as a normal mentor turn
  in the current thread; `activeMode` stays `mentor`, nothing written to DB.
- **Switch** (`mentor:idle:exit`) → translate mode via the shared
  `activateTranslateMode`, then the held text is translated so nothing typed
  is lost.
- A tap with no hold (>48 h prompt, session loss, second tap) is the stale
  path: alert, no AI call. Stay re-stamps activity without touching an
  existing thread pin; Switch still switches.
- Over-long input (`MENTOR_MAX_INPUT_LENGTH`) is never held — it falls
  through to today's rejection.

## Mode entity

- `USER_MODES` / `UserMode` moved to `packages/adapters/db/src/user-modes.ts`
  (adapter-db owns persisted enums; precedent `AUDIENCE_GROUPS`). `auth.ts`
  now imports adapter-db directly — a documented exception.
- `apps/bot/src/modes/mode-policy.ts` — leaf module with
  `MODE_POLICIES: Record<UserMode, ModePolicy>` (exhaustive: a new mode does
  not compile until it declares `idleTimeoutMs`) and the pure session
  writers `startMentorThread`, `markMentorActivity`, `isMentorIdle`,
  `takeMentorIdlePrompt`.
- `session.mentor` is a three-way state: `undefined` = recover latest
  thread from DB; `{ lastTurnAt }` = fresh thread; `{ threadId, lastTurnAt }`
  = pinned. `markMentorActivity` never materialises the `undefined` case.

## Observability

- `mentor.idle_prompt_shown { idleMs }`, `mentor.idle_prompt_choice { choice }`
- `bot_mentor_idle_prompts_total{outcome=shown|stay|translate|stale}`
- Revision rule for the window: stay-rate > 85 % → widen; switch-rate > 50 %
  → tighten.

## Tests

- Unit: `apps/bot/src/modes/__tests__/mode-policy.test.ts`,
  `apps/bot/src/scenes/helpers/mentor-idle.helper.test.ts`, rewritten
  assertions in the existing mentor scene/helper tests.
- E2E (rule 5a): `apps/bot/src/__tests__/integration/mentor-idle.integration.test.ts`
  through the real dispatcher and Postgres.

## Non-goals / follow-ups

- No DB schema change, no admin setting for the window.
- Follow-up: bare-word shape detection (`idle OR bare-word`) as a second
  trigger into the same decision point.
- Follow-up: pass `userMessageId` through the retry path too.
