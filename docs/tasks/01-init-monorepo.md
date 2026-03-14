# Task 01: Init project with monorepo

**Status:** ✅ Done

## Description

Set up the monorepo structure using pnpm workspaces as described in `tech-reqs/03-monorepo.md` and `tech-reqs/02-architecture.md`.

## Subtasks

- [x] Init root `package.json` with `"private": true` and pnpm workspaces config
- [x] Create `pnpm-workspace.yaml` pointing to `packages/*` and `apps/*`
- [x] Scaffold package directories:
  - `packages/core/` — platform-independent business logic (`@polyglot/core`)
  - `packages/adapters/db/` — Drizzle + PG adapter (`@polyglot/adapter-db`)
  - `packages/adapters/ai/` — Vercel AI SDK + OpenRouter adapter (`@polyglot/adapter-ai`)
  - `packages/adapters/notifications/` — node-cron scheduler (`@polyglot/adapter-notifications`)
  - `apps/bot/` — grammY Telegram bot (`@polyglot/bot`)
- [x] Add `package.json` to each workspace with correct `name` and cross-workspace `dependencies` (`workspace:*`)
- [x] Set up TypeScript 5.x:
  - Root `tsconfig.json` (base config, strict mode)
  - Per-package `tsconfig.json` extending root
- [x] Install shared dev dependencies at root: `typescript`, `vitest`, `@vitest/coverage-v8`
- [x] Create `shared/logger.ts` (Pino + Betterstack transport) per `tech-reqs/16-logging.md`
- [x] Create `shared/config.ts` (ENV validation with Zod) per `tech-reqs/13-env.md`
- [x] Create `.env.example` with all required variables (`BOT_TOKEN`, `DATABASE_URL`, `AI_PROVIDER`, API keys, `BETTERSTACK_TOKEN`, `NODE_ENV`)
- [x] Add root scripts: `dev`, `build`, `test`, `test:watch`, `test:coverage`
- [x] Add `.gitignore` (node_modules, dist, .env, coverage)
- [x] Verify `pnpm install` succeeds and workspaces resolve correctly

## Acceptance criteria

- `pnpm install` runs without errors
- All 5 workspace packages are recognized (`pnpm ls --depth 0 -r`)
- TypeScript compiles across all packages (`pnpm -r run build` or `tsc --noEmit`)
- Vitest runs from root (`pnpm test`)
