# Task 43 — Persistent Session Storage with Versioning

**Status:** 🔲 To Do  
**Category:** Architecture — Critical  
**Blocks:** Milestone 2.0 (SRS)

---

## Goal

Replace grammY's default in-memory session storage with a persistent backend (PostgreSQL or Redis). Add session versioning so schema changes don't silently corrupt existing sessions.

Currently sessions are purely in-memory — a bot restart loses all active flashcard decks, pending translations, template wizards, and dictionary browse state. Sessions also store full `WordDisplayData[]` arrays and `TranslateOutput` objects by value, causing memory pressure at scale.

## Problem Analysis

```typescript
// apps/bot/src/index.ts — no storage adapter = in-memory only
bot.use(
  session({
    initial: (): SessionData => ({ ... }),
    // No `storage:` key — grammY defaults to RAM
  }),
);

// apps/bot/src/types.ts — large objects stored by value
interface SessionData {
  flashcard?: {
    deck: WordDisplayData[];    // Full word objects per card!
    ...
  };
  pendingTranslation?: TranslateOutput;  // Full AI response!
  lastTranslation?: TranslateOutput;     // Another full AI response!
}
```

Consequences:
- Bot restart = all sessions lost (users mid-flashcard, mid-save lose everything silently)
- 100 concurrent users × ~10KB session ≈ 1MB; 10K users = 100MB volatile state
- No session version field — adding/removing SessionData fields silently corrupts existing sessions
- SRS (Milestone 2.0) will need even more session state (review queue, ratings, progress)

## Required Behavior

1. Add a persistent session storage adapter (PostgreSQL via `@grammyjs/storage-supabase` or custom Drizzle-based, or Redis)
2. Store large payloads by reference (DB ID or cache key), not by value
3. Add `sessionVersion: number` field with migration logic on load
4. Ensure graceful degradation: if session data is corrupt/outdated, reset to defaults

## Acceptance Criteria

- [ ] Session storage backed by PostgreSQL (new `bot_sessions` table) or Redis
- [ ] Session survives bot restart: user mid-flashcard can continue after restart
- [ ] `SessionData` includes `version: number` field (initial value: 1)
- [ ] Session load logic: if `version` < current → migrate or reset to defaults with warning log
- [ ] `flashcard.deck` stored by reference: session holds entry IDs, deck rebuilt from DB on access
- [ ] `pendingTranslation` and `lastTranslation` stored as cache key or reduced to essential fields (original, sourceLang, translation keys) — not full AI response
- [ ] Migration for `bot_sessions` table (if PostgreSQL approach)
- [ ] Existing tests pass
- [ ] New test: session persists across simulated restart
- [ ] New test: outdated session version triggers graceful reset

## Dependencies

None (can be done independently)

## Effort Estimate

6–8 hours (storage adapter: 2h, session refactor: 3h, versioning logic: 1h, tests: 2h)

## Files Likely Affected

- `packages/adapters/db/src/schema.ts` — add `bot_sessions` table (if PG)
- `packages/adapters/db/drizzle/` — new migration
- `apps/bot/src/session-storage.ts` — NEW persistent storage adapter
- `apps/bot/src/types.ts` — add `version` field, refactor large payload fields to references
- `apps/bot/src/index.ts` — pass `storage:` option to `session()`
- `apps/bot/src/scenes/helpers/flashcard.helper.ts` — rebuild deck from IDs instead of stored array
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — adapt pending/last translation to reference storage
