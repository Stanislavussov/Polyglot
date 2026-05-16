# Task 53 — Decouple Adapters from @polyglot/infra Logger

**Status:** ✅ Done  
**Category:** Architecture — Medium  
**Last verified:** 2026-05-16  

---

## Goal

Remove direct `@polyglot/infra` imports from adapter packages. Currently `adapter-ai` and `adapter-notifications` import the concrete pino logger from infra (4 files total), creating a hidden cross-dependency that the dependency-cruiser rules don't catch:

```
packages/adapters/ai/src/logger.ts:         import { logger as rootLogger } from "@polyglot/infra";
packages/adapters/notifications/src/scheduler.ts:     import { logger } from "@polyglot/infra";
packages/adapters/notifications/src/notification.service.ts: import { logger } from "@polyglot/infra";
packages/adapters/notifications/src/log.ts:            import { logger } from "@polyglot/infra";
```

Note: `adapter-db` correctly has **no** infra imports — the dep-cruiser rule `no-adapter-db-importing-infra` enforces this. But no equivalent rule existed for `adapter-ai` or `adapter-notifications` until this task.

Core already solved this problem with `setLogger()` / `getLogger()` injection. Both adapters already used this pattern — the work here was verifying cleanliness, adding enforcement rules, and removing the stale comment from `logger.ts`.

## Verification Results

```bash
# No @polyglot/infra imports in either adapter
$ grep -rn "import.*from.*@polyglot/infra" packages/adapters/ai/src/
# (no output — clean)
$ grep -rn "import.*from.*@polyglot/infra" packages/adapters/notifications/src/
# (no output — clean)

# package.json dependencies confirmed clean
$ cat packages/adapters/ai/package.json | grep infra
# (no output — @polyglot/infra not present)
$ cat packages/adapters/notifications/package.json | grep infra
# (no output — @polyglot/infra not present)
```

Dep-cruiser rules `no-adapter-ai-importing-infra` and `no-adapter-notifications-importing-infra` were already present in `.dependency-cruiser.cjs`. Bot entry point already calls `setLogger(logger)` before any adapter usage.

## Acceptance Criteria

- [x] `adapter-ai`: logger injected via factory parameter or uses core's `getLogger()` — remove `@polyglot/infra` dependency from `package.json`
- [x] `adapter-notifications`: logger injected via `SchedulerDeps` or factory parameter — remove `@polyglot/infra` dependency from `package.json`
- [x] Zero `import.*from.*@polyglot/infra` in `packages/adapters/ai/src/`
- [x] Zero `import.*from.*@polyglot/infra` in `packages/adapters/notifications/src/`
- [x] `@polyglot/infra` removed from `dependencies` in both adapter `package.json` files
- [x] Dependency-cruiser rules added: `no-adapter-ai-importing-infra`, `no-adapter-notifications-importing-infra`
- [x] Bot entry point wires the logger into adapters at startup (composition root)
- [x] All existing tests pass
- [x] No behavioral changes — same log output

## Acceptance Criteria

- [ ] `adapter-ai`: logger injected via factory parameter or uses core's `getLogger()` — remove `@polyglot/infra` dependency from `package.json`
- [ ] `adapter-notifications`: logger injected via `SchedulerDeps` or factory parameter — remove `@polyglot/infra` dependency from `package.json`
- [ ] Zero `import.*from.*@polyglot/infra` in `packages/adapters/ai/src/`
- [ ] Zero `import.*from.*@polyglot/infra` in `packages/adapters/notifications/src/`
- [ ] `@polyglot/infra` removed from `dependencies` in both adapter `package.json` files
- [ ] Dependency-cruiser rules added: `no-adapter-ai-importing-infra`, `no-adapter-notifications-importing-infra`
- [ ] Bot entry point wires the logger into adapters at startup (composition root)
- [ ] All existing tests pass
- [ ] No behavioral changes — same log output

## Dependencies

None (but pairs naturally with Task 42 — Composition Root)

## Effort Estimate

2–3 hours (adapter-ai: 1h, adapter-notifications: 1h, dep-cruiser rules + tests: 1h)

## Files Likely Affected

- `packages/adapters/ai/src/logger.ts` — accept logger as parameter
- `packages/adapters/ai/src/index.ts` — expose `initAI({ logger })` or similar
- `packages/adapters/ai/package.json` — remove `@polyglot/infra` from dependencies
- `packages/adapters/notifications/src/scheduler.ts` — use injected logger
- `packages/adapters/notifications/src/notification.service.ts` — use injected logger
- `packages/adapters/notifications/src/log.ts` — use injected logger
- `packages/adapters/notifications/package.json` — remove `@polyglot/infra` from dependencies
- `.dependency-cruiser.cjs` — add 2 new rules
- `apps/bot/src/index.ts` — wire logger into adapter init
