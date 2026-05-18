# Task 45 — Extract Domain Types into Dedicated @polyglot/types Package

**Status:** 🔲 To Do  
**Category:** Architecture — Critical  
**Blocks:** Milestone 1.2 (Dictionary Polish), clean adapter swappability

---

## Goal

Extract application/persistence domain types (`User`, `VocabularyEntry`, `UserSettings`, etc.) out of `@polyglot/adapter-db` into a **new dedicated `@polyglot/types` package**. Currently these types are Drizzle ORM `$inferSelect` inference types defined inside the DB adapter. The bot layer imports them directly:

```typescript
// apps/bot/src/types.ts
import type { User } from "@polyglot/adapter-db";  // Drizzle inference type!

// apps/bot/src/renderers/dictionary.renderer.ts
import type { VocabTranslationDetails, VocabularyEntryWithTranslations } from "@polyglot/adapter-db";

// apps/bot/src/utils/vocabulary-mapper.ts
import type { CreateVocabularyInput, VocabTranslationDetails } from "@polyglot/adapter-db";
```

All of these are `typeof table.$inferSelect` — tightly coupled to schema column names and Drizzle types. Renaming a DB column breaks every consumer across the app.

## Why NOT in `@polyglot/core`?

Core is **pure business logic** — translation, validation, i18n, idiom analysis. Types like `User`, `UserSettings`, `CreateVocabularyInput`, `WordReview` are **application/persistence concepts**, not translation domain concepts. Putting them in core would:

1. Make core know about the storage domain (users, vocabulary entries, reviews)
2. Turn core into a dumping ground where every new table gets a mirror type
3. Blur the boundary — core should be platform-independent translation logic, not an entity layer

Core already correctly owns its own business types: `TranslateInput`, `TranslateOutput`, `LanguageTranslation`, `DictionaryContext`, `WordDisplayData`, etc.

## Architecture Decision

**New package: `@polyglot/types`** — a thin package with **zero logic, zero dependencies, only type definitions (interfaces and type aliases)**.

```
packages/types/
  src/
    user.ts           — User, UserSettings
    vocabulary.ts     — VocabularyEntry, VocabularyTranslation, ...
    review.ts         — WordReview
    notification.ts   — NotificationUser, NotificationPayload (shared)
    index.ts          — barrel export
  package.json
  tsconfig.json
```

Dependency graph:

```
@polyglot/types         ← zero deps, only interfaces
    ↑           ↑
    │           │
@polyglot/core    @polyglot/adapter-db    @polyglot/bot
(does NOT        (implements/maps to)    (imports types)
 import it)
```

- **Core does NOT import `@polyglot/types`** — core stays pure business logic
- **adapter-db implements/maps to types** — replaces `$inferSelect` exports with domain interfaces
- **Bot imports from `@polyglot/types`** — clean, no adapter dependency for types
- **adapter-notifications imports from `@polyglot/types`** — for shared types like `NotificationUser`

## Required Behavior

1. Create `@polyglot/types` package with zero-logic domain interfaces
2. adapter-db repositories return `@polyglot/types` interfaces (mapped from Drizzle select types internally)
3. Bot and other consumers import types from `@polyglot/types`, not from adapter-db
4. Core remains untouched — does not import `@polyglot/types`

## Acceptance Criteria

### Package Setup
- [ ] `packages/types/` created with `package.json` (`name: "@polyglot/types"`, zero dependencies)
- [ ] `packages/types/tsconfig.json` with same base config as other packages
- [ ] `pnpm-workspace.yaml` already covers `packages/*` — verify `@polyglot/types` is picked up
- [ ] Package has **zero runtime dependencies** — only type exports

### Domain Interfaces
- [ ] `packages/types/src/user.ts`: `User`, `UserSettings` interfaces (plain fields, no Drizzle artifacts)
- [ ] `packages/types/src/vocabulary.ts`: `VocabularyEntry`, `VocabularyTranslation`, `VocabularyEntryWithTranslations`, `VocabTranslationDetails`, `CreateVocabularyInput`, `UpdateTranslationData`
- [ ] `packages/types/src/review.ts`: `WordReview`
- [ ] `packages/types/src/notification.ts`: `NotificationUser` (shared between adapter-notifications and bot)
- [ ] `packages/types/src/index.ts` barrel re-exports all types
- [ ] Each interface has only domain-relevant fields — no `$inferSelect`, no Drizzle column metadata

### adapter-db Mapping
- [ ] adapter-db adds `@polyglot/types` as dependency
- [ ] `user.repository.ts` returns `User` / `UserSettings` from `@polyglot/types` (map internally from Drizzle inference)
- [ ] `vocabulary.repository.ts` returns `VocabularyEntry` etc. from `@polyglot/types`
- [ ] `word-review.repository.ts` returns `WordReview` from `@polyglot/types`
- [ ] Internal Drizzle types (`typeof users.$inferSelect`) stay private to repository files — not re-exported

### Bot Migration
- [ ] `apps/bot/src/types.ts` imports `User` from `@polyglot/types` instead of `@polyglot/adapter-db`
- [ ] `apps/bot/src/renderers/dictionary.renderer.ts` imports from `@polyglot/types`
- [ ] `apps/bot/src/utils/vocabulary-mapper.ts` imports from `@polyglot/types`
- [ ] Zero `import type { ... } from "@polyglot/adapter-db"` in the bot layer (only value imports for repository singletons remain — addressed by Task 42)

### Boundary Enforcement
- [ ] `@polyglot/core` does **NOT** depend on `@polyglot/types` — verify no imports
- [ ] Dependency-cruiser rule added: `no-core-importing-types` (error severity)

### Quality
- [ ] All existing tests pass
- [ ] TypeScript compilation succeeds across all packages with no new errors
- [ ] `pnpm lint:deps` passes with no new violations

## Dependencies

None (can be done before or after Task 42)

## Effort Estimate

4–5 hours (package setup: 0.5h, define interfaces: 1.5h, add mapping in adapter-db: 1.5h, migrate bot imports: 1h, dep-cruiser + tests: 0.5h)

## Files Likely Affected

- `packages/types/` — NEW package
- `packages/types/src/user.ts` — NEW
- `packages/types/src/vocabulary.ts` — NEW
- `packages/types/src/review.ts` — NEW
- `packages/types/src/notification.ts` — NEW
- `packages/types/src/index.ts` — NEW barrel
- `packages/types/package.json` — NEW
- `packages/types/tsconfig.json` — NEW
- `packages/adapters/db/package.json` — add `@polyglot/types` dependency
- `packages/adapters/db/src/repositories/user.repository.ts` — map to domain types
- `packages/adapters/db/src/repositories/vocabulary.repository.ts` — map to domain types
- `packages/adapters/db/src/repositories/word-review.repository.ts` — map to domain types
- `apps/bot/package.json` — add `@polyglot/types` dependency
- `apps/bot/src/types.ts` — change User import source
- `apps/bot/src/renderers/dictionary.renderer.ts` — change type import source
- `apps/bot/src/utils/vocabulary-mapper.ts` — change type import source
- `.dependency-cruiser.cjs` — add `no-core-importing-types` rule
