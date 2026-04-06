# Task 48 — Extract Notification Scheduler to Separate Process

**Status:** 🔲 To Do  
**Category:** Architecture — High  
**Blocks:** Milestone 2.2 (Notifications at scale), reliability

---

## Goal

Separate the notification scheduler from the bot process. Currently the bot polling, cron scheduler, DB connections, and AI calls all run in a single Node.js process:

```typescript
// apps/bot/src/index.ts
async function main(): Promise<void> {
  await loadLanguageCache();
  wireNotificationScheduler(bot.api);  // cron starts in same process
  bot.start({ ... });                   // polling starts in same process
}
```

The scheduler runs `cron.schedule("0 * * * *", ...)` inside the bot process. Heavy notification sending (AI word suggestions, DB queries for all users) can block bot message handling. A scheduler crash takes down the entire bot.

## Required Behavior

1. Notification scheduler runs as an independent entry point
2. Bot process and scheduler process share the same DB but run independently
3. Scheduler communicates with Telegram via Bot API directly (already does — uses injected `sendFn`)
4. Both processes can be started/stopped/scaled independently
5. Development mode: single process is still possible (for convenience)

## Acceptance Criteria

- [ ] `apps/scheduler/` — NEW app in the monorepo (or `apps/bot/src/scheduler-entry.ts` as a separate entry point)
- [ ] Scheduler entry point loads config, DB, language cache, and starts the cron loop — no bot polling
- [ ] Scheduler sends notifications via Telegram Bot API directly (using bot token, no grammY Bot instance needed — raw API calls)
- [ ] `apps/bot/src/index.ts` no longer calls `wireNotificationScheduler()` when `SCHEDULER_ENABLED=false` (env toggle)
- [ ] `pnpm-workspace.yaml` updated if new app added
- [ ] `package.json` scripts: `pnpm scheduler` to run scheduler independently
- [ ] Docker-compose example (or documentation) showing bot + scheduler as separate services
- [ ] Graceful shutdown for scheduler process (stop cron, close DB)
- [ ] Dev mode: `SCHEDULER_ENABLED=true` in bot process still works (backward compatible)
- [ ] Existing notification tests pass unchanged
- [ ] New test: scheduler entry point starts and shuts down cleanly

## Dependencies

None (notification adapter already uses dependency injection for `sendFn`)

## Effort Estimate

4–6 hours (entry point: 2h, env toggle: 0.5h, raw API send: 1.5h, docker-compose + docs: 1h, tests: 1h)

## Files Likely Affected

- `apps/scheduler/` or `apps/bot/src/scheduler-entry.ts` — NEW entry point
- `apps/bot/src/index.ts` — conditional `wireNotificationScheduler()` based on env toggle
- `packages/infra/src/config.ts` — add `SCHEDULER_ENABLED` env var
- `pnpm-workspace.yaml` — add new workspace (if separate app)
- `package.json` (root) — add `pnpm scheduler` script
- `docker-compose.yml` — NEW or updated with scheduler service
- `apps/bot/src/notifications/notification.wiring.ts` — potentially extract shared wiring logic
