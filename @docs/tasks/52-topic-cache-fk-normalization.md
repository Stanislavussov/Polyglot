# Task 52 — Wire Topic Translation Cache (Currently Dead Code)

**Status:** 🔲 To Do  
**Category:** Architecture — Medium  
**Blocks:** Milestone 3.0 (Topic Sets)

---

## Goal

Wire the topic translation cache pipeline end-to-end. Currently the **entire topic caching system is dead code** — the table is empty, the repository is never called from the app, and the notification wiring stubs out all cache operations with no-ops.

Once wired, also normalize the `sourceLang`/`targetLang` text columns to FK references for consistency with the rest of the schema.

## Problem Analysis

### What exists but is unused:

1. **DB table** `topic_translation_cache` — exists, has schema, indexes, and migration. **Empty in production.**

2. **Repository** `topicRepository` — has `getCached()`, `setCached()`, `markInvalid()`. **Never imported by the app.**

```bash
$ grep -rn "topicRepository\." apps/ --include="*.ts" | grep -v test
# (empty — zero usages)
```

3. **Core service** `topic.service.ts` — `createTopicService(deps)` accepts `getCached`/`setCached` in its deps and uses them for cache-first translation. **Works correctly in isolation.**

4. **Notification wiring** `notification.wiring.ts` — creates a `topicService` but stubs out all cache operations:

```typescript
// apps/bot/src/notifications/notification.wiring.ts
const topicService = createTopicService({
  translateBatch: async () => [],     // stub — no AI calls
  translateOne: async () => ({ ... }),  // stub — no AI calls
  getCached: async () => null,          // stub — always "cache miss"
  setCached: async () => {},            // stub — discard writes
});
```

This means every notification topic word lookup goes to the AI stub (which returns empty), and no translations are ever cached. The notification `pickSuggestedWord()` works only because it falls back to topic dataset words (hardcoded JSON), not translated ones.

5. **No bot command** for topic browsing exists yet — topics are only used as a word source for notifications.

### FK inconsistency (secondary issue):

`topicTranslationCache` uses `text` columns for `sourceLang` and `targetLang`, while all other tables use integer FK references to `languages.id`:

```typescript
// topicTranslationCache — raw strings, not FK
sourceLang: text("source_lang").notNull(),
targetLang: text("target_lang").notNull(),

// vocabularyEntries — normalized FK
sourceLangId: integer("source_lang_id").references(() => languages.id).notNull(),
```

## Required Behavior

### Phase 1: Wire the cache (make it functional)
1. Notification wiring passes the real `topicRepository.getCached`/`setCached` instead of stubs
2. Topic word lookups hit the cache before calling AI
3. AI-translated topic words are stored in the cache for reuse

### Phase 2: Normalize FK columns (consistency)
1. Replace `sourceLang`/`targetLang` text columns with integer FK references to `languages.id`
2. Update repository queries accordingly
3. Update unique/lookup indexes

## Acceptance Criteria

### Phase 1 — Wire cache
- [ ] `apps/bot/src/notifications/notification.wiring.ts` passes real `topicRepository.getCached` and `topicRepository.setCached` to `createTopicService()`
- [ ] `translateBatch`/`translateOne` deps wired to real AI adapter (with rate awareness — cache prevents repeated AI calls)
- [ ] After a notification picks a topic word, the translation is cached in `topic_translation_cache`
- [ ] Subsequent lookups for the same (topicId, original, sourceLang, targetLang) hit the cache
- [ ] Existing notification tests updated or extended to verify cache write
- [ ] New test: first call → AI + cache write; second call → cache hit, no AI

### Phase 2 — Normalize FK
- [ ] Migration: add `source_lang_id` and `target_lang_id` integer FK columns
- [ ] Backfill from existing text values (if any cached rows exist by then)
- [ ] Drop old `source_lang` and `target_lang` text columns
- [ ] Unique index updated: `(topicId, original, sourceLangId, targetLangId)`
- [ ] Lookup index updated: `(topicId, sourceLangId, targetLangId)`
- [ ] `topicRepository` queries updated to use FK IDs
- [ ] `TopicDeps.getCached`/`setCached` signatures in core updated to accept language IDs or codes (resolved in repository)
- [ ] Schema consistent with `vocabularyEntries`/`vocabularyTranslations` FK pattern

### Quality
- [ ] All existing tests pass
- [ ] Notification scheduler still works end-to-end
- [ ] No behavioral regressions in flashcard or dictionary features

## Dependencies

Phase 1: None  
Phase 2: Phase 1 (wire first, then normalize the schema of a now-functional table)

## Effort Estimate

Phase 1: 3–4 hours (wire deps: 1.5h, test cache flow: 1.5h, update notification tests: 1h)  
Phase 2: 2–3 hours (migration: 1h, repository update: 1h, tests: 1h)  
**Total: 5–7 hours**

## Files Likely Affected

### Phase 1
- `apps/bot/src/notifications/notification.wiring.ts` — replace stubs with real `topicRepository`
- `packages/adapters/notifications/src/notification.service.ts` — verify cache-first flow works
- Notification test files — verify cache writes

### Phase 2
- `packages/adapters/db/src/schema.ts` — update `topicTranslationCache` columns
- `packages/adapters/db/drizzle/` — NEW migration
- `packages/adapters/db/src/repositories/topic.repository.ts` — update queries to use FK IDs
- `packages/core/src/modules/topics/types.ts` — update `TopicDeps.getCached`/`setCached` signatures
- `packages/core/src/modules/topics/topic.service.ts` — adapt to new signatures
