# Task 49 — Centralize Adapter Configuration (Remove process.env Leaks)

**Status:** 🔲 To Do  
**Category:** Architecture — Medium  

---

## Goal

Remove direct `process.env` access from adapter packages. Two adapters bypass the centralized config module (`@polyglot/infra`'s `loadConfig()`) and read environment variables directly:

```typescript
// packages/adapters/db/src/connection.ts
const databaseUrl = process.env.DATABASE_URL;  // Direct env access — no validation

// packages/adapters/ai/src/client.ts
const apiKey = process.env.OPENROUTER_API_KEY;  // Direct env access — no validation
```

Meanwhile `packages/infra/src/config.ts` has a Zod-validated `loadConfig()` that validates `DATABASE_URL` and `OPENROUTER_API_KEY` at startup. The adapters ignore this and fail lazily on first use with unhelpful errors.

## Required Behavior

1. Adapters receive configuration through factory/constructor parameters
2. The composition root (bot entry point) loads config once and passes it to adapter factories
3. No adapter reads `process.env` directly

## Acceptance Criteria

- [ ] `packages/adapters/db/src/connection.ts`: `createDb()` accepts `databaseUrl: string` parameter; remove `process.env.DATABASE_URL` access
- [ ] `packages/adapters/ai/src/client.ts`: `getClient()` or `initClient()` accepts `apiKey: string` parameter; remove `process.env.OPENROUTER_API_KEY` access
- [ ] `apps/bot/src/index.ts`: passes `config.DATABASE_URL` and `config.OPENROUTER_API_KEY` to adapter init functions
- [ ] Startup fails fast with clear error if config is missing (handled by infra's Zod validation, not by adapters)
- [ ] Zero `process.env` references remain in `packages/adapters/` (excluding `drizzle.config.ts` which is a dev tool)
- [ ] All existing tests pass (tests can pass config explicitly or use test env)
- [ ] New test: adapter factory throws clear error when called without config (not a vague "env var not set" message)

## Dependencies

None

## Effort Estimate

2–3 hours (refactor factories: 1h, update entry point: 0.5h, update tests: 1h)

## Files Likely Affected

- `packages/adapters/db/src/connection.ts` — accept config param instead of reading env
- `packages/adapters/ai/src/client.ts` — accept config param instead of reading env
- `apps/bot/src/index.ts` — pass config to adapter init
- `packages/infra/src/config.ts` — ensure all needed env vars are validated
- Test files that rely on `process.env` setup for DB/AI — update to pass config explicitly
