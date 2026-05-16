# Task 44 — Unify Language Cache with TTL Refresh

**Status:** 🔲 To Do  
**Category:** Architecture — High  
**Blocks:** Horizontal scaling, runtime language management

---

## Goal

Merge the two global language caches into a single service with TTL-based refresh. Currently two separate module-level `Map` instances hold identical data loaded once at startup with no refresh mechanism:

1. `packages/adapters/db/src/language-cache.ts` — `const byCode = new Map<string, CachedLanguage>()`
2. `packages/core/src/modules/i18n/language-registry.ts` — `const byCode = new Map<string, LanguageEntry>()`

Both are populated during `main()` in `apps/bot/src/index.ts`:

```typescript
await loadLanguageCache();                    // adapter-db cache
const allLangs = getAllLangs();               // read from adapter-db cache
initLanguageRegistry(allLangs);               // copy into core registry
```

Consequences:
- Adding/changing languages requires a full bot restart
- Two copies of the same data with no sync mechanism
- Global mutable state makes testing unreliable (leaks between tests)
- Multiple bot instances (horizontal scaling) have independent stale caches

## Required Behavior

1. Single language service owned by core (interface) with adapter-db implementation
2. TTL-based refresh (e.g., every 5 minutes) — configurable
3. Exposed through composition root (Task 42), not as globals
4. Thread-safe read access during refresh (swap-on-complete pattern)

## Acceptance Criteria

- [ ] `LanguageCacheService` interface in `packages/core/src/ports/` with methods: `getLang()`, `getAllLangs()`, `getSupportedLangs()`, `getLangName()`, `getLangNativeName()`, `getLangFlag()`, `getLangDisplay()`, `isKnownLang()`, `normalizeToIso1()`, `refresh()`
- [ ] Single implementation in `packages/adapters/db/src/language-cache.ts` that replaces both caches
- [ ] `packages/core/src/modules/i18n/language-registry.ts` deprecated — all callers migrated to the unified service
- [ ] TTL-based auto-refresh: `setInterval` with configurable period (default: 5 minutes), disabled in tests
- [ ] Swap-on-complete: build new Map, then replace reference atomically — readers never see partial state
- [ ] `initLanguageRegistry()` removed from `apps/bot/src/index.ts` startup — replaced by single `languageCache.load()`
- [ ] Core functions that previously used the global registry (`getLanguageName`, `getLangDisplay` etc.) now accept the cache as a parameter or use the injected service
- [ ] All existing tests pass
- [ ] New test: cache refresh picks up a newly inserted language without restart

## Dependencies

- Task 42 (Composition Root) — recommended but not required; can use singleton as interim

## Effort Estimate

4–6 hours (interface: 1h, merge implementations: 2h, migrate callers: 2h, TTL + tests: 1h)

## Files Likely Affected

- `packages/core/src/ports/language-cache.ts` — NEW interface
- `packages/adapters/db/src/language-cache.ts` — rewrite as unified implementation with TTL
- `packages/core/src/modules/i18n/language-registry.ts` — deprecate/remove
- `packages/core/src/modules/i18n/i18n.ts` — update to use new service
- `packages/core/src/index.ts` — update re-exports
- `apps/bot/src/index.ts` — simplify startup to single `languageCache.load()`
- All files importing from `language-registry.ts` or `language-cache.ts` — migrate to unified API
