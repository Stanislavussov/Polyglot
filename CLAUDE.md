# Polyglot — AI Assistant Instructions

## Hard Rules (never violate)

### 1. Quality Gate After Every Change

After implementing any feature — no matter how small — update `CHANGELOG.md` and run the full quality gate:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```

- Fix all failures before proceeding
- Do not defer fixes to "later"
- Keep user-facing and operational changes under `## [Unreleased]` in `CHANGELOG.md`
- `pnpm db:push` is the final step — applies schema changes to local/dev database
- Run the test catalog script (`pnpm test:catalog`, output `apps/admin/reports-data/test-catalog.*`) and commit its artifacts **only when test files changed**; otherwise leave any spurious regeneration out of the commit (`git restore apps/admin/reports-data/test-catalog.*`). (The reports directory was moved out of `apps/admin/public/` in Fable T09 so the reports are no longer served anonymously; they are now behind the cookie-gated SSR endpoint `apps/admin/src/pages/reports/[...file].ts`.)

**Exception — Documentation-only changes:** When the only files touched are Markdown (`.md`), task specs, readmes, or changelogs, skip the quality gate. Running `pnpm build`, `pnpm lint`, and `pnpm test` is useless if no source code changed. In that case, only verify that the Markdown renders correctly and `CHANGELOG.md` is updated if needed.

### 2. No `any` Types

Never use `any`, `// @ts-ignore`, or `// @ts-expect-error`. Fix the underlying type issue instead.

### 3. Database Handling via Drizzle Kit

All database schema work goes through `drizzle-kit`, but agents must not run production-style migrations from a local run.

```bash
pnpm db:generate   # generate migrations from schema changes
pnpm db:push       # push schema changes to the local/dev database
pnpm db:check      # validate the migration folder/journal (NOT a drift check)
```

- Edit `packages/adapters/db/src/schema.ts`, then generate migrations
- When database structure changes on the `develop` branch, run `pnpm db:generate`, review the generated migration, then run `pnpm db:push` against the local/dev database
- Never hand-edit migration files or use raw SQL
- `pnpm db:push` is allowed and often necessary for local/dev databases
- **`pnpm db:migrate` is forbidden on the `develop` branch — never run it there, even with user approval.** On `develop` the only DB workflow is `pnpm db:generate` (capture the migration) followed by `pnpm db:push` (apply schema to the local/dev DB). Migrations are *applied* (`db:migrate`) exclusively by CI/deploy pipelines (GitHub Actions / GitLab CI) when merging to `master`.
- Do **not** run `pnpm db:migrate` locally as an agent on any branch
- `pnpm db:push` syncs **schema only** — it does **not** insert seed/row data (e.g. the `languages` table rows). Seed data reaches dev DBs via the migration applied in CI, or via an idempotent Drizzle-based (never raw SQL) seed/upsert — never by hand-running `db:migrate` on `develop`.
- **When hand-writing a data-seed migration, take the column list from the current `packages/adapters/db/src/schema.ts`, never by copying an `INSERT` from an older migration.** Old seed migrations (e.g. `0002_languages_metadata.sql`) reference columns that were valid then but may have since been dropped (e.g. `iso3_code`, removed in `0007_drop_iso3_code.sql`). Copying them re-introduces a non-existent column, and `drizzle-kit migrate` fails with `42703 column "…" does not exist` — and because a failed migration is never recorded in `__drizzle_migrations`, every later deploy re-runs and re-fails it (a new migration can't route around it; you must fix the offending file itself).

### 4. No Logic in Index Files

Index files (e.g. `index.ts`) must contain **only** re-exports. Never add logic, side effects, or runtime code to them.

- Avoid creating or using barrel files that re-export from other modules. Import directly from the source module instead.
- If a barrel file already exists, do not expand it — import from the underlying file directly.
- Exception: framework-required entry points are allowed.

### 5. Spec-First Testing Workflow

For every feature, bug fix, refactor, or behavior change that touches source code, work from a behavior specification before implementation:

1. Restate or write a concise spec: public interface/workflow, expected behavior, important constraints, edge cases, and non-goals.
2. Use the `testing-strategy-tdd` skill automatically whenever tests are being planned, written, reviewed, or changed; its canonical guidance is `@docs/agents/testing-strategy-tdd.md`.
3. Derive tests from the spec before writing production code. Prefer behavior and integration tests that cross meaningful module boundaries.
4. Avoid low-value tests that only prove variables, trivial getters/setters, internal call counts, private methods, framework behavior, or types already enforced by TypeScript.
5. Implement through small red-green-refactor slices: one meaningful failing test, minimal code to pass, refactor after green, then the next scenario.
6. Cover realistic happy paths plus high-risk edge cases: validation failure, permissions, empty data, duplicates, boundaries, external failure, retries, idempotency, and persistence where relevant.

If a change is too small to need a new test, explicitly state why existing tests or static checks already cover the behavior.

#### 5a. E2E coverage for cross-cutting features (mandatory)

A flow that crosses layers (bot command/callback/conversation → service → persisted state, or scheduler → delivery) is **not done** without an `*.integration.test.ts` driving it through the real dispatcher against the real Postgres, written per the `bot-testing` skill (`.claude/skills/bot-testing/SKILL.md`) — read it first.

- Bot-facing → `apps/bot/src/__tests__/integration/`; persistence-only → `packages/adapters/db/src/__tests__/`.
- A mock-only unit test never satisfies this rule.
- Run `pnpm test:integration` before claiming completion — the standard gate (`pnpm test`) runs the unit lane only.
- Skip only by naming the existing integration test that covers the flow. "Hard to test" or "later" is a blocker, not a completion.

### 6. Deployment & Host Provisioning

Two **separate** pipelines — never conflate them. Canonical guidance: `@docs/agents/deployment.md`.

- **App deploy** (`.github/workflows/deploy.yml`, on push to `master`): builds/pushes images and runs `docker compose up`. Touches containers only — never nginx, TLS, or host config.
- **Host provisioning** (`deploy/ansible/site.yml`, run via `pnpm ansible` → `scripts/run-ansible.sh`): UFW, Docker, nginx reverse proxies, certbot TLS. Reads `.env.prod`; each routing block is gated by its domain env var (`LANDING_DOMAIN`, `ADMIN_PANEL_DOMAIN` + `ADMIN_API_DOMAIN`, `GRAFANA_DOMAIN`; any TLS needs `ACME_EMAIL`).

Rules:

- Production provisioning is a manual, explicit step. Do **not** run `pnpm ansible` against production without an explicit, separate user request for that exact action — same posture as `pnpm db:migrate`.
- Before provisioning a new domain, confirm DNS points at the VPS (certbot fails and burns Let's Encrypt quota otherwise). The playbook is idempotent; certs are guarded by `creates:`.
- Manage GitHub Actions secrets with `gh secret set` (value via stdin). Sync infra/Ansible vars from `.env.prod`. Do **not** push derived/generated vars (`*_IMAGE_NAME`, ports, `NODE_ENV`, `*_URL` — the deploy workflow computes them), and do **not** sync `VPS_SSH_KEY` from `.env.prod` (it is a file *path* locally but must hold the key *contents* in GitHub).

Run these steps **when there are related code changes** (a change isn't done until handled — surface it even if you can't execute it):

- Changed `deploy/ansible/**` / nginx routing, or added a domain or service needing host routing → re-apply with `pnpm ansible` (still gated by the explicit-prod rule above; confirm DNS first). The change is dormant until then.
- Added/changed an infra var in `.env.prod` that Ansible or the deploy workflow consumes → push it with `gh secret set`, or CI runs with stale values.
- App-code/container-only changes → none of this applies; the app-deploy pipeline covers it.

## Project Context

- **Monorepo**: pnpm workspaces (`packages/*`, `packages/adapters/*`, `apps/*`)
- **Stack**: TypeScript, Biome (lint/format), Vitest (tests), dependency-cruiser
- **Database**: PostgreSQL via Drizzle ORM (`packages/adapters/db`)
- **Documentation**: `@docs/` is the canonical documentation directory. Do not create or write to a top-level `docs/` directory.
- **Agent guidance**: `@docs/agents/` is the canonical, harness-neutral agent guidance — read it before editing.
  - `@docs/agents/architecture.md` — repository layout, boundaries, and the **Module Contracts** (stable per-module design invariants: AI/db adapters, i18n, validation, translation, topics, dictionary-pipeline, notifications, bot).
  - `@docs/agents/quality-gate.md` — required checks after changes.
  - `@docs/agents/workflows.md` — planning, implementation, review, and documentation flows.
  - `@docs/agents/testing-strategy-tdd.md` — spec-first TDD and test strategy.
  - `@docs/agents/observability.md` — trace context, the event catalogue, and how to add a log line.
  - `@docs/agents/skills.md` — compact role index for domain-specific work.
