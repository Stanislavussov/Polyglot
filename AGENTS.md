# Polyglot — AI Assistant Instructions

## Hard Rules (never violate)

### 1. Quality Gate After Every Change

After implementing any feature — no matter how small — run the full quality gate:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm test
```

- Fix all failures before proceeding
- Do not defer fixes to "later"

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
- Never hand-edit migration files or use raw SQL
- `pnpm db:push` is allowed and often necessary for local/dev databases
- Do **not** run `pnpm db:migrate` locally as an agent
- Production/staging migration application must happen through the deployment pipeline
- Local `pnpm db:migrate` requires an explicit, separate user request for that exact command

### 4. No Logic in Index Files

Index files (e.g. `index.ts`) must contain **only** re-exports. Never add logic, side effects, or runtime code to them.

- Avoid creating or using barrel files that re-export from other modules. Import directly from the source module instead.
- If a barrel file already exists, do not expand it — import from the underlying file directly.
- Exception: framework-required entry points are allowed.

## Project Context

- **Monorepo**: pnpm workspaces (`packages/*`, `packages/adapters/*`, `apps/*`)
- **Stack**: TypeScript, Biome (lint/format), Vitest (tests), dependency-cruiser
- **Database**: PostgreSQL via Drizzle ORM (`packages/adapters/db`)
- **Agent skills**: `.pi/skills/` (read `dev-standards` skill after every change)
