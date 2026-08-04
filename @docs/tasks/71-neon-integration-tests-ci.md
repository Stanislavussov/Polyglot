# Task 71 — Real-database integration tests (v2: free Postgres CI lane + optional Neon lane)

> **Status: IMPLEMENTED (v2, 2026-08-01).** The v1 plan (appendix, historical) locked Neon
> ephemeral branches as the only engine. v2 re-scoped after a cost review: **Neon bills
> compute-hours**, and an integration job on every develop push would keep burning them.
> The CI engine is now a **free, runner-local Postgres service container**; the Neon
> branch lane is preserved as an **optional local path** behind an API token.
> SQLite was considered and rejected: the Drizzle schema is PostgreSQL
> (jsonb, serial, enums, timestamptz) — only a real Postgres validates it.

## Architecture (v2)

Two Vitest lanes, one shared invariant: the integration lane runs only against a
**throwaway, migrated + seeded** Postgres reachable via `TEST_DATABASE_URL`, and
**never falls back to `DATABASE_URL`** (so it can never touch dev/prod).

| Lane | Command | Engine | Cost |
|---|---|---|---|
| Base (mock-only) | `pnpm test` | none | free |
| Integration, CI | `ci.yml` `integration` job | `services: postgres:17` container, new+empty per run, destroyed with the job | free |
| Integration, local | `TEST_DATABASE_URL=… pnpm test:integration` | any Postgres (docker one-liner in the script's help text) | free |
| Integration, Neon (optional) | `pnpm test:integration` with `NEON_API_KEY`+`NEON_PROJECT_ID` | ephemeral branch from `ci-base`, trap-deleted | Neon compute-hours |

- `vitest.integration.config.ts` — `include: **/*.integration.test.ts`, `maxWorkers: 2`,
  `testTimeout: 30000`; aliases `@grammyjs/transformer-throttler` to a pass-through stub
  (the harness answers API calls instantly; real flood-limit pacing would only slow tests).
- `test/integration/setup.ts` — fail-fast on missing `TEST_DATABASE_URL`, maps it onto
  `DATABASE_URL` before the connection singleton loads, fake `BOT_TOKEN`,
  `loadLanguageCache()` from the real seeded `languages` rows, `closeDb()` teardown.
- Base `vitest.config.ts` excludes `**/*.integration.test.ts` — `pnpm test` is unchanged.

## Provisioning sequence (all lanes)

```
db:migrate  → schema + languages data-seed (migrations 0002 + 0040) — the prod path
admin:seed  → rate_limit_plans (free/plus/pro/unlimited) + plan_feature_access
            (idempotent upserts; optional superadmin only if ADMIN_EMAIL/PASSWORD set)
test:integration:run
```

## Fresh-database bootstrap inventory

What a **brand-new empty database** needs before a user can use the bot
(asserted by `packages/adapters/db/src/__tests__/bootstrap.integration.test.ts`):

| Config | Source | Empty-DB behavior without it |
|---|---|---|
| `languages` (46 rows, 11 supported) | migrations `0002` + `0040` (via `db:migrate`) | registry loads empty → every language flow breaks (no throw!) |
| `rate_limit_plans` + default `free` | `pnpm admin:seed` | `getPlanLimit()` → null; entitlements have no plan to enforce |
| `plan_feature_access` | `pnpm admin:seed` | premium features silently disabled for paid plans |
| `ai_models` | admin panel (optional) | falls back to hardcoded `FALLBACK_AI_MODEL` |
| `system_settings` (`ai.defaults`, `srs`, …) | admin panel (optional) | hardcoded code defaults |
| `translation_presets` | admin panel (optional) | empty list |

### Migration-chain repair (found by this lane)

Replaying the committed chain on an **empty** database failed twice — i.e. a full
DB re-creation was impossible before v2:

1. **`0015_closed_pepper_potts.sql`** — a drizzle-kit catch-up that re-created
   tables/columns the hand-written migrations `0003`–`0014` already made (the
   snapshots had drifted). Repaired with idempotency guards only (`IF NOT EXISTS`,
   `DROP … IF EXISTS`, `DO $$ … duplicate_object` for constraints) — no semantic
   change; live DBs already record it as applied and skip it by journal timestamp.
2. **`0043_purple_viper.sql`** — altered `topic_translation_cache`, but **no
   migration ever created that table** (it reached live DBs via `db:push` only).
   Prepended a guarded `CREATE TABLE IF NOT EXISTS` with the final (timestamptz)
   shape + its two indexes; a no-op on live DBs.

Hand-editing migrations is normally forbidden; both edits are the sanctioned
"fix the offending file itself" case (a broken chain cannot be repaired by a
*later* migration, because replay fails before reaching it).

## Coverage (v1 scope, recovered from stash@{0} 2026-07-06 and reconciled)

- **Repositories** (`packages/adapters/db/src/__tests__/*.integration.test.ts`):
  user upsert/idempotency, vocabulary save/pagination/LIKE-escaping/duplicates,
  bot-session storage round-trips + translation-map eviction, fresh-DB bootstrap.
- **grammY e2e** (`apps/bot/src/__tests__/integration/*.integration.test.ts`) on a
  real dispatch harness (`bot-harness.ts`): `/start` onboarding (user row + language
  prompt, no duplicate on second `/start`), translate happy path (AI mocked via DI,
  vocab persisted, card rendered), callback regressions (session-expired, eviction
  end-to-end `1e6407c`, 48h edit-limit fallback `d9b330f`).
- Harness notes: outbound Telegram calls are intercepted by a **fake `fetch`**
  passed through the factory's client options — transformer-level mocks miss the
  conversations plugin's cloned Api (in-conversation replies would hit the real
  API). `messageUpdate` auto-attaches the `bot_command` entity for `/commands`
  (grammY matches on the entity, not the text). Tests arrange their own data with
  unique telegram ids; no shared fixtures, no cleanup, no unscoped mutations.

## CI (`.github/workflows/ci.yml`)

`integration` job: `services: postgres:17` (health-checked) → `pnpm install` →
`pnpm build` → `pnpm db:migrate` → `pnpm admin:seed` → `pnpm test:integration:run`,
with `DATABASE_URL`/`TEST_DATABASE_URL` pointing at the runner-local container.
Runs on push/PR to develop and master; the master deploy still gates through
`deploy.yml`'s `workflow_call` of `ci.yml`. **No secrets, no Neon usage, no
concurrency group needed** (nothing shared between runs). Node 26 everywhere
(prod parity with `.nvmrc` / `node:26-alpine`).

## Optional Neon lane (one-time human setup, only if/when wanted)

1. Create an API key (Neon console → Account → API keys); put `NEON_API_KEY` +
   `NEON_PROJECT_ID` in the git-ignored `.env`.
2. Create the permanent empty base branch once:
   `neonctl branches create --project-id <id> --name ci-base --parent main`, then
   `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on it.
3. `pnpm test:integration` then provisions `local/<user>-<ts>-<pid>` from
   `ci-base` (pinned `neonctl@2.15.0`, direct — never pooled — connection string,
   env-only, never echoed), migrates + seeds, tests, and trap-deletes the branch
   on EXIT/INT/TERM. `pnpm neon:prune` sweeps leaked `local/*`/`ci/*` stragglers.

This lane is **not** wired into CI. If it is ever added back, remember that repo
secrets do not flow through `workflow_call` — they must be declared in
`ci.yml`'s `workflow_call.secrets` and passed explicitly from `deploy.yml`.

---

## Appendix — v1 plan (historical, superseded)

v1 (ralplan consensus 2026-07-05: Planner draft → Architect `SOUND-WITH-CHANGES` →
Critic `ITERATE` (1 major: `workflow_call` secret propagation) → revision →
Architect `SOUND` → Critic `APPROVE`) locked Neon ephemeral branches as the sole
engine for both CI and local, with a global `concurrency: neon-integration`
group, `neondatabase/create-branch-action`/`delete-branch-action` in CI, and
explicit `NEON_API_KEY`/`NEON_PROJECT_ID` pass-through from `deploy.yml` (that
secret-propagation detail was v1's MAJOR review finding). The implementation was
completed 2026-07-05/06 but sat uncommitted in `git stash@{0}` until v2
recovered it. v2 keeps v1's lane design, harness, tests, and scripts; it
replaces the CI engine with a free Postgres service container (cost), adds the
bootstrap-seed step and the fresh-DB bootstrap test, repairs the migration chain
for empty-DB replay, and fixes two harness gaps v1 could not see (fetch-level
interception for conversation-cloned Api instances; `bot_command` entities on
synthetic command updates).
