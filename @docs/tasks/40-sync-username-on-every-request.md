# Task 40 — Sync Telegram Username to DB on Every Request

## Goal

New users (and returning users who change their Telegram username) don't have their current `username` stored in the database. The auth middleware only sets `username` on user creation, never updates it.

## Problem Analysis

In `apps/bot/src/middlewares/auth.ts`:

```ts
if (!user) {
  user = await userRepository.create({
    telegramId,
    username: ctx.from?.username ?? null,
  });
}
// ← existing users: username is NEVER updated
```

Issues:
1. Users who had no username at first registration → `username` stays `null` forever
2. Users who change their Telegram username → DB has stale value
3. Any admin/analytics/notification feature relying on `users.username` gets wrong data

## Required Behavior

On every request, if the Telegram-provided username differs from the stored one, update it in the DB.

## Acceptance Criteria

- [ ] Auth middleware compares `ctx.from.username` with `user.username` on every request
- [ ] If different (including `null` → value or value → `null`), update the DB
- [ ] Update is fire-and-forget (non-blocking) — don't slow down every request
- [ ] Add `updateUsername(userId, username)` method to `userRepository` (or reuse a general update)
- [ ] Add test: existing user with changed username → DB updated after middleware runs
- [ ] Add test: existing user with same username → no DB call

## Dependencies

None

## Effort Estimate

1–2 hours

## Files Likely Affected

- `apps/bot/src/middlewares/auth.ts` — add username sync after user lookup
- `packages/adapters/db/src/repositories/user.repository.ts` — add `updateUsername()` method
- `apps/bot/src/middlewares/auth.test.ts` — add test cases for username sync
- `packages/adapters/db/src/__tests__/user.repository.test.ts` — test `updateUsername()`
