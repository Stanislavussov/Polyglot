# Task 55 — Health Check & Basic Observability

**Status:** 🔲 To Do  
**Category:** Architecture — Medium  
**Blocks:** Production reliability, incident detection

---

## Goal

Add health checking and basic operational metrics. Currently the project has **zero** health endpoints, metrics collection, or structured error tracking — just pino logging. When notifications silently fail, AI responses degrade, or the DB connection drops, there's no way to detect it proactively.

```bash
# Verified: zero health/metrics/monitoring code in the entire codebase
$ grep -rn "health\|metrics\|sentry\|prometheus\|monitoring" apps/ packages/ --include="*.ts"
# (empty)
```

## Required Behavior

1. Health check mechanism (bot ping command or HTTP endpoint)
2. Key operational metrics tracked and logged periodically
3. Structured error context for debugging

## Acceptance Criteria

### Health Check
- [ ] `/health` bot command (admin-only or public) that reports: bot uptime, DB connection status, scheduler status (running/stopped), language cache age
- [ ] OR: lightweight HTTP server on a separate port (e.g., `:8080/healthz`) returning JSON status — usable by Docker healthcheck / load balancer
- [ ] Health check verifies DB connectivity (simple `SELECT 1` query)
- [ ] Health check verifies language cache is loaded and not stale

### Operational Metrics (logged periodically or on-demand)
- [ ] Translation metrics: count per hour, average duration, error rate (logged on each translation, aggregatable from logs)
- [ ] Notification metrics: sent/failed/skipped counts per scheduler tick (already partially logged — formalize)
- [ ] AI adapter metrics: request count, token usage, cost per hour (already in `logRequest()` — ensure structured fields)
- [ ] Rate limit hits: count per hour (once Task 47 is wired)

### Error Context
- [ ] Bot error handler (`bot.catch`) includes structured context: userId, command, session mode, error type
- [ ] AI errors include: model, prompt length, retry count
- [ ] DB errors include: query type, table name (where feasible)

## Dependencies

None (but benefits from Task 47 — Rate Limiting for rate-limit metrics)

## Effort Estimate

4–5 hours (health endpoint: 2h, metric logging: 1.5h, error context: 1h, tests: 0.5h)

## Files Likely Affected

- `apps/bot/src/health.ts` — NEW health check implementation
- `apps/bot/src/index.ts` — register health command or start HTTP server
- `apps/bot/src/index.ts` (`bot.catch`) — enrich error context
- `packages/adapters/ai/src/logger.ts` — ensure structured metric fields
- `packages/adapters/notifications/src/scheduler.ts` — formalize metric logging
- `packages/adapters/db/src/connection.ts` — add `ping()` or `isConnected()` function
