# Task 23: Link `translation_requests` Table to `languages`

## Task: Replace TEXT language columns in `translation_requests` with FK references to `languages`

**Goal:** Establish referential integrity between `translation_requests` and the `languages` table by replacing the plain-text `source_lang` column and the `target_langs` text array with proper foreign-key references to `languages.id`. This is a focused subset of the broader language-table refactor (Task 14), scoped exclusively to `translation_requests`.

## Current State

```typescript
// packages/adapters/db/src/schema.ts
export const translationRequests = pgTable(
  "translation_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    original: text("original").notNull(),
    sourceLang: text("source_lang"),             // ← plain text, no FK
    targetLangs: text("target_langs").array().notNull(), // ← text[], no FK
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);
```

- `sourceLang` stores a raw ISO 639-1 code (`"en"`, `"ru"`) with no referential constraint.
- `targetLangs` is a `text[]` array — impossible to enforce FK integrity on individual elements.
- No repository file exists for `translationRequests` yet; the table is defined in the schema but has no dedicated data-access layer.

## Target State

### 1. `translationRequests` — replace `sourceLang` TEXT with FK

```typescript
export const translationRequests = pgTable(
  "translation_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    original: text("original").notNull(),
    sourceLangId: integer("source_lang_id").references(() => languages.id), // nullable, FK to languages
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("translation_requests_user_idx").on(t.userId),
    index("translation_requests_user_date_idx").on(t.userId, t.createdAt),
  ],
);
```

### 2. New junction table — `translationRequestTargetLangs`

```typescript
export const translationRequestTargetLangs = pgTable(
  "translation_request_target_langs",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => translationRequests.id, { onDelete: "cascade" }).notNull(),
    languageId: integer("language_id").references(() => languages.id).notNull(),
  },
  (t) => [
    index("tr_target_langs_request_idx").on(t.requestId),
    uniqueIndex("tr_target_langs_unique_idx").on(t.requestId, t.languageId),
  ],
);
```

### 3. New `translation-request.repository.ts`

```typescript
// Minimal public API:
export function logTranslationRequest(userId: number, original: string, sourceLangCode: string | null, targetLangCodes: string[]): Promise<number>;
export function getUserRequestsInWindow(userId: number, windowStart: Date): Promise<number>;  // for rate limiting
export function getRecentRequests(userId: number, limit: number): Promise<TranslationRequestDTO[]>;
```

- Repository accepts/returns language **codes** (strings) — resolves to/from `languages.id` internally via joins.
- Callers never deal with language IDs directly.

## Acceptance Criteria

- [ ] `sourceLang` TEXT column replaced with `sourceLangId` INTEGER FK → `languages.id` (nullable)
- [ ] `targetLangs` TEXT[] column removed; replaced by `translationRequestTargetLangs` junction table
- [ ] Junction table has composite unique index on `(requestId, languageId)` and an index on `requestId`
- [ ] Drizzle migration generated and applies cleanly against existing data
- [ ] Data migration script populates `sourceLangId` from existing `sourceLang` text values and populates junction table from `targetLangs` array
- [ ] Old `sourceLang` and `targetLangs` columns dropped after data migration
- [ ] New `translation-request.repository.ts` created with at least `logTranslationRequest` and `getUserRequestsInWindow`
- [ ] Repository methods accept/return language codes (strings), not IDs
- [ ] All existing callers of `translationRequests` schema (if any) updated to use the repository
- [ ] Existing indexes preserved or improved
- [ ] Tests pass — schema tests, repository tests, and any integration tests

## Dependencies

- **Task 14** (partially) — the `languages` table and seed data must already exist. The `languages` table is already in the schema, so this task can proceed independently.
- **None blocking** — `translationRequests` currently has no repository or direct consumers in the codebase beyond the schema definition.

**Estimated Effort:** 3–4 hours

## Files likely affected

- `packages/adapters/db/src/schema.ts` — modify `translationRequests`, add `translationRequestTargetLangs`
- `packages/adapters/db/src/repositories/translation-request.repository.ts` — **new file**
- `packages/adapters/db/src/index.ts` — export new repository and junction table
- `packages/adapters/db/drizzle/` — new migration file(s)
- `packages/adapters/db/src/__tests__/schema.test.ts` — update schema tests for new structure

## Migration Strategy

### Step 1: Add new columns & junction table (non-breaking)

```sql
-- Add FK column (nullable)
ALTER TABLE translation_requests ADD COLUMN source_lang_id INTEGER REFERENCES languages(id);

-- Create junction table
CREATE TABLE translation_request_target_langs (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES translation_requests(id) ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES languages(id),
  UNIQUE(request_id, language_id)
);
CREATE INDEX tr_target_langs_request_idx ON translation_request_target_langs(request_id);
```

### Step 2: Migrate existing data

```sql
-- Populate source_lang_id from existing text column
UPDATE translation_requests tr
SET source_lang_id = l.id
FROM languages l
WHERE tr.source_lang = l.code
  AND tr.source_lang IS NOT NULL;

-- Populate junction table from text[] column
INSERT INTO translation_request_target_langs (request_id, language_id)
SELECT tr.id, l.id
FROM translation_requests tr
CROSS JOIN LATERAL unnest(tr.target_langs) AS target_code
JOIN languages l ON l.code = target_code;
```

### Step 3: Drop old columns

```sql
ALTER TABLE translation_requests DROP COLUMN source_lang;
ALTER TABLE translation_requests DROP COLUMN target_langs;
```

## Notes

- This task is intentionally narrow — only `translation_requests` is touched. Other tables (`words`, `userLanguageSettings`, `topicTranslationCache`) are tracked separately in Task 14.
- The junction table ensures DB-level FK enforcement on every target language, guaranteeing full referential integrity with `languages`.
- If any language codes in existing data don't exist in `languages`, the migration must seed them first or skip those rows with a warning.
