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

**Exception — Documentation-only changes:** When the only files touched are Markdown (`.md`), task specs, readmes, or changelogs, skip the quality gate. Running `pnpm build`, `pnpm lint`, and `pnpm test` is useless if no source code changed. In that case, only verify that the Markdown renders correctly and `CHANGELOG.md` is updated if needed.

### 2. No `any` Types

Never use `any`, `// @ts-ignore`, or `// @ts-expect-error`. Fix the underlying type issue instead.

### 3. Database Handling via Drizzle Kit

All database schema work goes through `drizzle-kit`, but agents must not run production-style migrations from a local run.

```bash
pnpm db:generate   # generate migrations from schema changes
pnpm db:push       # push schema changes to the local/dev database
pnpm db:check      # check for schema drift
```

- Edit `packages/adapters/db/src/schema.ts`, then generate migrations
- When database structure changes on the `develop` branch, run `pnpm db:generate`, review the generated migration, then run `pnpm db:push` against the local/dev database
- Never hand-edit migration files or use raw SQL
- `pnpm db:push` is allowed and often necessary for local/dev databases
- Do **not** run `pnpm db:migrate` locally as an agent
- Production/staging migration application via `pnpm db:migrate` must happen only inside CI/deploy pipelines such as GitHub Actions or GitLab CI
- Local `pnpm db:migrate` requires an explicit, separate user request for that exact command

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

## Project Context

- **Monorepo**: pnpm workspaces (`packages/*`, `packages/adapters/*`, `apps/*`)
- **Stack**: TypeScript, Biome (lint/format), Vitest (tests), dependency-cruiser
- **Database**: PostgreSQL via Drizzle ORM (`packages/adapters/db`)
- **Documentation**: `@docs/` is the canonical documentation directory. Do not create or write to a top-level `docs/` directory.
- **Agent guidance**: `@docs/agents/` is the canonical harness-neutral agent guidance. `.pi/skills/` contains only thin Pi-specific adapters.
