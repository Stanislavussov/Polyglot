# Task 50 — SRS Schema Foundation (Design + Migration)

**Status:** ✅ Done  
**Category:** Architecture — High  
**Blocks:** Milestone 2.0 (Spaced Repetition)

---

## Goal

Design and create the database schema for Spaced Repetition (SM-2 algorithm) so that current development doesn't paint the project into a corner. The current schema has `wordReviewLog` (append-only review log) but no SRS scheduling state: no ease factor, no interval, no due date, no per-language review tracking.

Per BRD §7.3, SRS must track each target language **separately** for each vocabulary entry (each language is reviewed independently). This means SRS state lives at the `vocabulary_translations` level, not at the `vocabulary_entries` level.

## Implementation Summary

Implemented as Option A: SRS columns live directly on `vocabulary_translations`. This matches the normalized schema from Task 39: each target language translation is already its own row, so adding `srs_ease_factor`, `srs_interval`, `srs_due_date`, and `srs_review_count` keeps review state per language without a parallel `srs_cards` table.

Scope delivered beyond schema foundation:
- Core SM-2 scheduler in `packages/core/src/modules/srs/`
- `/review` Telegram command with due-card session, reveal, and `Again / Hard / Good / Easy` ratings
- SRS repository methods: `findDueForSrs()` and `updateSrsState()`
- New vocabulary translations are first scheduled for next-day review
- Review completion logs `word_review_log.sessionType = 'srs'`

## Problem Analysis

Current state:
- `vocabulary_entries` — the word/phrase itself (user + original + source lang)
- `vocabulary_translations` — one row per target language per entry
- `word_review_log` — append-only log with `sessionType` (flashcard|notification|quiz|srs)

Missing for SM-2:
- Per-translation SRS scheduling columns (ease factor, interval, due date, review count)
- "First review scheduled for next day after saving" trigger
- "Overdue cards ordered by overdue duration" query support
- Per-user session cap (max 20 overdue cards)

## Required Behavior

1. Add SRS columns to `vocabulary_translations` (or create a separate `srs_cards` table with 1:1 FK)
2. Design supports SM-2 algorithm: ease factor, interval (days), next review date, review count
3. Provide a query pattern for "get overdue cards for user, ordered by overdue duration, limit 20"
4. First review date auto-set on vocabulary entry creation
5. This task is **schema-only** — no algorithm implementation (that's Milestone 2.0)

## Acceptance Criteria

- [x] Decision documented: SRS columns on `vocabulary_translations` (Option A) vs. separate `srs_cards` table (Option B) — with rationale
- [x] Drizzle migration created: `0020_demonic_blur.sql`
- [x] New columns (if Option A on `vocabulary_translations`):
  - `srs_ease_factor REAL DEFAULT 2.5 NOT NULL` (SM-2 default)
  - `srs_interval INTEGER DEFAULT 0 NOT NULL` (days)
  - `srs_due_date TIMESTAMP` (nullable — null = never reviewed, show immediately)
  - `srs_review_count INTEGER DEFAULT 0 NOT NULL`
- [x] Or new table `srs_cards` (if Option B) with FK to `vocabulary_translations.id` — not chosen
- [x] Index on `srs_due_date` for efficient "get overdue" queries (filtered by joined user entry)
- [x] Schema updated in `packages/adapters/db/src/schema.ts`
- [x] `vocabulary_translations` type updated (if Option A) — existing code still compiles
- [x] No behavioral changes — existing flashcard, dictionary, notification features unaffected
- [x] Migration tested: applies cleanly to existing data, all nullable/default columns handle existing rows
- [x] Design doc or comment block explaining SM-2 column semantics

## Files Created / Modified

- `packages/adapters/db/src/schema.ts`
- `packages/adapters/db/src/repositories/vocabulary.repository.ts`
- `packages/adapters/db/drizzle/0020_demonic_blur.sql`
- `packages/adapters/db/drizzle/meta/0020_snapshot.json`
- `packages/core/src/modules/srs/`
- `packages/core/src/ports/vocabulary.repository.ts`
- `apps/bot/src/scenes/srs.scene.ts`
- `apps/bot/src/scenes/helpers/srs.helper.ts`
- `apps/bot/src/renderers/srs.renderer.ts`
- `apps/bot/src/index.ts`
- `apps/bot/src/commands/commands.ts`
- `apps/bot/src/types.ts`
- `packages/core/src/modules/i18n/locales/{en,ru,cs}.json`
- `packages/core/src/modules/i18n/types.ts`

## Dependencies

None (schema-only, no algorithm)

## Effort Estimate

3–4 hours (design decision: 1h, migration: 1h, schema update: 0.5h, testing + docs: 1h)

## Files Likely Affected

- `packages/adapters/db/src/schema.ts` — add SRS columns or new table
- `packages/adapters/db/drizzle/0016_srs_scheduling.sql` — NEW migration
- `packages/adapters/db/drizzle/meta/` — updated migration metadata
- `docs/tech-reqs/05-db-schema.md` — update schema documentation
