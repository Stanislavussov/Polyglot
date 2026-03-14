# Task 02: Create DB schemas and push to DB

**Status:** ✅ Done (except `db:push` — requires DATABASE_URL)

## Description

Implement the Drizzle ORM schema in `packages/adapters/db/` as described in `tech-reqs/05-db-schema.md`, set up migrations, and push to a PostgreSQL database.

## Subtasks

- [x] Install dependencies in `@polyglot/adapter-db`: `drizzle-orm`, `postgres` (or `pg`), `drizzle-kit`
- [x] Create `packages/adapters/db/schema.ts` with all tables:
  - `users` — `id`, `telegramId` (bigint, unique), `username`, `onboardingStep`, `onboarded`, `isActive`, `createdAt`
  - `userLanguageSettings` — `id`, `userId` (FK → users, unique, 1-to-1), `interfaceLang`, `nativeLang`, `learningLangs` (text array), `timezone`, `isActive`, `updatedAt`
  - `words` — `id`, `userId` (FK → users), `original`, `sourceLang`, `content` (JSONB with full AI response per target language), `isActive`, `createdAt`, `updatedAt` + index on `userId`
  - `translationRequests` — `id`, `userId` (FK → users), `original`, `sourceLang`, `targetLangs` (text array), `createdAt` + indexes on `userId` and `(userId, createdAt)`
- [x] Create `drizzle.config.ts` reading `DATABASE_URL` from env
- [x] Create `packages/adapters/db/index.ts` with `getDb()` singleton (creates one connection pool)
- [x] Generate initial migration: `pnpm drizzle-kit generate`
- [ ] Push schema to database: `pnpm drizzle-kit push` (or `migrate`) — ⚠️ requires running PostgreSQL with DATABASE_URL set
- [ ] Verify tables exist in PostgreSQL (connect and inspect) — ⚠️ requires running PostgreSQL
- [x] Create repository stubs per `tech-reqs/14-agents.md`:
  - `repositories/user.repository.ts` — `findByTelegramId()`, `create()`, `updateSettings()`
  - `repositories/word.repository.ts` — `create()`, `findByUser()`, `findById()`, `search()`, `delete()`
- [x] Add basic repository tests (vitest, integration against test DB)

## Acceptance criteria

- `drizzle-kit generate` produces a valid migration
- `drizzle-kit push` applies schema to PostgreSQL without errors
- All 4 tables (`users`, `user_language_settings`, `words`, `translation_requests`) exist with correct columns, types, and indexes
- `getDb()` returns a working Drizzle client
- Repository stubs compile and export correct interfaces
