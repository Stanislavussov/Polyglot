# Task 42 — Composition Root & Dependency Injection

**Status:** ✅ Done  
**Category:** Architecture — Critical  
**Blocks:** Milestone 2.0 (SRS), Milestone 4.0 (Multi-platform)

---

## Goal

Eliminate hard-wired singleton imports from the bot layer. Currently 18 non-test files in `apps/bot/src/` import concrete repositories and functions directly from `@polyglot/adapter-db`, and 2 files import `generateObject` directly from `@polyglot/adapter-ai`. There are zero abstract repository interfaces anywhere in the codebase — despite `docs/tech-reqs/04-adapter-contract.md` specifying `UserRepository` and `NotificationAdapter` port interfaces that were designed but never implemented.

Replace direct imports with a composition root that wires dependencies once at startup and passes them through context.

## Problem Analysis

```
# 18 files with direct adapter-db imports:
apps/bot/src/scenes/helpers/translate-mode.helper.ts
  → import { userRepository, vocabularyRepository, ... } from "@polyglot/adapter-db";
apps/bot/src/scenes/helpers/settings.helper.ts
  → import { getSupportedLangs, userRepository, ... } from "@polyglot/adapter-db";
apps/bot/src/scenes/helpers/flashcard.helper.ts
  → import { getAllLangs, userRepository, vocabularyRepository, wordReviewRepository } from "@polyglot/adapter-db";
# ...16 more files

# 2 files with direct adapter-ai imports:
apps/bot/src/scenes/helpers/translate-mode.helper.ts
  → import { generateObject } from "@polyglot/adapter-ai";
apps/bot/src/scenes/helpers/regen.helper.ts
  → import { generateObject } from "@polyglot/adapter-ai";
```

Consequences:
- Can't swap DB implementation (e.g., for a test double or different storage)
- Can't reuse bot logic for a web/mobile app without dragging in Telegram deps
- Every new feature deepens the coupling (SRS, quizzes, topics all need more repos)
- Tests must mock module-level singletons — fragile

## Required Behavior

1. Define port interfaces in `@polyglot/core` for each repository used by the app
2. Create a `ServiceContainer` type that bundles all services
3. Inject the container at startup via grammY context (`ctx.services`)
4. Migrate handlers file-by-file from direct imports to `ctx.services.*`
5. Update dependency-cruiser to forbid direct adapter imports from bot scenes/helpers

## Acceptance Criteria

- [x] Port interfaces defined in `packages/core/src/ports/`: `UserRepository`, `VocabularyRepository`, `TranslationTemplateRepository`, `WordReviewRepository`, `NotificationRepository`, `TranslationRequestRepository`, `LanguageCachePort`, `AIPort`
- [x] `ServiceContainer` interface defined in `packages/core/src/ports/container.ts` aggregating all ports
- [x] `apps/bot/src/container.ts` creates the concrete container from adapter implementations
- [x] `BotContext` extended with `services: ServiceContainer`
- [x] Container injected via middleware in `apps/bot/src/index.ts` (before auth middleware)
- [x] At least 3 handler files migrated from direct imports to `ctx.services.*` (translate-mode.helper, settings.helper, flashcard.helper) as proof of pattern
- [x] Remaining files tracked with `// TODO(task-42): migrate to ctx.services` comments
- [x] Dependency-cruiser rule added: `no-bot-scenes-importing-adapters` (warning severity, not error — allows incremental migration)
- [x] All existing tests pass
- [x] New test: container is properly wired and injected into context

## Dependencies

None (foundational task)

## Effort Estimate

6–8 hours (interfaces: 2h, container + middleware: 2h, migrate 3 files: 2h, tests + dep-cruiser: 2h)

## Files Likely Affected

- `packages/core/src/ports/` — NEW directory with port interfaces
- `packages/core/src/ports/container.ts` — NEW ServiceContainer type
- `packages/core/src/index.ts` — re-export ports
- `apps/bot/src/container.ts` — NEW composition root
- `apps/bot/src/types.ts` — extend BotContext with `services`
- `apps/bot/src/index.ts` — inject container middleware
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — migrate imports
- `apps/bot/src/scenes/helpers/settings.helper.ts` — migrate imports
- `apps/bot/src/scenes/helpers/flashcard.helper.ts` — migrate imports
- `.dependency-cruiser.cjs` — add new rule
