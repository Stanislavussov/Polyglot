# Task 63 — Parameterize Bot by Environment

**Status:** 🔲 To Do  
**Category:** Bot / Configuration — High  
**Blocks:** Environment-aware logging, feature flags, safe testing, separate Telegram bots per env  
**Last verified:** 2026-06-14  

---

## Goal

Make the Telegram bot aware of which environment it is running in (`production`, `development`, `testing`). The bot must read an `ENVIRONMENT` variable at startup and adjust its behavior, logging verbosity, error handling, and external integrations accordingly. This enables safe testing without affecting production users, and allows multiple bot instances to coexist (e.g., a dev bot and a prod bot) without collisions.

## Current State

- Bot reads `BOT_TOKEN` and `DATABASE_URL` from config but has no environment identity
- `NODE_ENV` is used implicitly for some libraries (e.g., Astro, Fastify) but not by the bot itself
- The same bot token and database are used across all contexts
- Release announcements (Task 56) are sent to hardcoded audience groups
- Error reporting and logging are identical in local dev and production

## Required Behavior

### 1. Environment Variable

Introduce `ENVIRONMENT` as a required configuration variable:

- Allowed values: `production`, `development`, `testing`
- Must be validated at startup; bot refuses to start if missing or invalid
- Must be logged prominently on boot (e.g., `Environment: production`)
- Distinct from `NODE_ENV` (which controls Node.js / framework runtime behavior)

### 2. Bot Token Selection

Support per-environment bot tokens to avoid cross-environment message pollution:

- `BOT_TOKEN` — default / production token (required)
- `BOT_TOKEN_DEV` — development token (optional, falls back to `BOT_TOKEN`)
- `BOT_TOKEN_TEST` — testing token (optional, falls back to `BOT_TOKEN`)
- Bot selects the appropriate token based on `ENVIRONMENT`

### 3. Logging Behavior

Adjust logging based on environment:

- **production**: structured JSON logs (`pino` default), `info` level minimum, no stack traces in user-facing output
- **development**: pretty-printed logs, `debug` level allowed, verbose request/response tracing
- **testing**: minimal or silent logs unless `DEBUG=1` is set, to keep test output readable

### 4. Error Handling & Reporting

- **production**: errors logged to BetterStack (if `BETTERSTACK_TOKEN` present), user sees generic message
- **development**: errors logged to console with full stack traces, user sees detailed error in chat
- **testing**: errors thrown/rejected immediately (do not swallow), no external reporting

### 5. Release Announcements

- **production**: announce to all configured audience groups
- **development**: announce only to `admin` group (or skip entirely)
- **testing**: never announce

### 6. Feature Flags (Optional but Recommended)

Allow environment-specific feature toggling:

- `FEATURES` — comma-separated list of enabled features
- `FEATURES_DEV` / `FEATURES_TEST` — overrides per environment
- Bot registers only the enabled features at startup

### 7. Metrics & Health Check Labels

- Prometheus metrics should include an `environment` label (e.g., `polyglot_messages_total{environment="production"}`)
- Health check endpoint should return the environment name in its JSON response

## Acceptance Criteria

### Configuration
- [ ] `ENVIRONMENT` added to `packages/infra/src/config.ts` with Zod validation (`enum(['production', 'development', 'testing'])`)
- [ ] `packages/infra/src/config.ts` exports `getBotToken()` that selects token based on environment
- [ ] `.env.example` updated with `ENVIRONMENT`, `BOT_TOKEN_DEV`, `BOT_TOKEN_TEST`
- [ ] Bot startup fails fast with a clear error if `ENVIRONMENT` is missing or invalid

### Logging
- [ ] `setLogger()` or `logger` configuration respects environment log level
- [ ] Production: JSON logs only, no pretty-printing
- [ ] Development: pretty-printed logs, `debug` level enabled
- [ ] Testing: silent or minimal logging

### Error Handling
- [ ] Production: catch-all middleware sends generic error message to user
- [ ] Development: error details sent to chat (or logged to console)
- [ ] Testing: errors propagate without catch-all suppression

### Release Announcements
- [ ] `release-announcement.cli.ts` checks `ENVIRONMENT` before sending
- [ ] Skipped entirely in `testing` environment
- [ ] Limited to `admin` audience in `development` environment

### Metrics
- [ ] `metrics.ts` adds `environment` label to all counters and histograms
- [ ] `/healthz` returns JSON with `{ "environment": "production" }`

### Tests
- [ ] Unit tests for `getBotToken()` covering all three environments
- [ ] Unit tests for config validation rejecting invalid `ENVIRONMENT` values
- [ ] Integration test verifying bot starts with each environment (smoke test)

## Dependencies

- Task 62 (Separate Deployment Environments) — provides the `ENVIRONMENT` variable
- Task 42 (Composition Root & DI) — config is already centralized in `packages/infra`

## Effort Estimate

4–6 hours (config changes: 1h, logging: 1h, error handling: 1h, testing: 1–2h)

## Files Likely Affected

- `packages/infra/src/config.ts` — add `ENVIRONMENT` and token selection
- `apps/bot/src/index.ts` — validate environment on startup, log it
- `apps/bot/src/metrics.ts` — add environment label
- `apps/bot/src/release-announcement.cli.ts` — environment-gated announcements
- `apps/bot/src/bot-factory.ts` or error handlers — environment-specific error behavior
- `.env.example` — document new variables
- `@docs/tech-reqs/13-env.md` — document environment variables

## Notes

- The bot token separation is **critical** for safe testing. Never use the production token in a test environment.
- If `BOT_TOKEN_DEV` or `BOT_TOKEN_TEST` are not provided, the bot should fall back to `BOT_TOKEN` but log a **warning** that environments are sharing a token.
- Consider prefixing the bot's webhook path (if ever used) with the environment name to avoid conflicts.
- `NODE_ENV` and `ENVIRONMENT` may diverge intentionally (e.g., `NODE_ENV=production` + `ENVIRONMENT=testing` for performance testing with production-like optimizations).
