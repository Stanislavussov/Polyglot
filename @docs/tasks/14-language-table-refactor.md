# Task 14: Refactor Language Usage to Use `languages` Table

**Status:** 🟡 Partial — `languages` table exists and seeded. `translationRequests.sourceLangId` migrated (Task 23). `language.repository.ts` exists. Remaining: `userLanguageSettings` FK, `words` FK, `topicTranslationCache` FK, junction tables, data migration.
**Last verified:** 2026-05-16

## Overview

Replace all hardcoded language code strings (`"en"`, `"ru"`, `"cs"`) with references to the normalized `languages` table. This centralizes language management, enables runtime language additions, and improves referential integrity.

## Current State

Language codes are stored as plain `TEXT` fields throughout the schema:

### `userLanguageSettings`
```typescript
interfaceLang: text("interface_lang").notNull(),      // "en", "ru", "cs"
nativeLang: text("native_lang").notNull(),            // "en", "ru", etc.
learningLangs: text("learning_langs").array(),        // ["cs", "de", "fr"]
```

### `words`
```typescript
sourceLang: text("source_lang").notNull(),            // "en", "ru"
```

### `translationRequests` ✅ (migrated by Task 23)
```typescript
// Already migrated — now uses FK references:
sourceLangId: integer("source_lang_id").references(() => languages.id),  // FK to languages
// targetLangs replaced by translationRequestTargetLangs junction table
```

### `topicTranslationCache`
```typescript
sourceLang: text("source_lang").notNull(),            // "en"
targetLang: text("target_lang").notNull(),            // "cs"
```

---

## Target State

### New `languages` Table (from Task 13)

```typescript
export const languages = pgTable(
  "languages",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),      // "en", "ru", "cs"
    name: text("name").notNull(),               // "English", "Russian", "Czech"
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("languages_code_idx").on(t.code)],
);
```

### Refactored Tables

#### `userLanguageSettings`
```typescript
export const userLanguageSettings = pgTable("user_language_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).unique().notNull(),
  interfaceLangId: integer("interface_lang_id").references(() => languages.id).notNull(),
  nativeLangId: integer("native_lang_id").references(() => languages.id).notNull(),
  // learningLangs → separate junction table (see below)
  timezone: text("timezone").default("UTC").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Junction table for many-to-many: user ↔ learning languages
export const userLearningLanguages = pgTable(
  "user_learning_languages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    languageId: integer("language_id").references(() => languages.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("user_learning_lang_unique_idx").on(t.userId, t.languageId),
    index("user_learning_lang_user_idx").on(t.userId),
  ],
);
```

#### `words`
```typescript
export const words = pgTable("words", {
  // ...existing fields...
  sourceLangId: integer("source_lang_id").references(() => languages.id).notNull(),
  // remove: sourceLang: text("source_lang")
});
```

#### `translationRequests`
```typescript
export const translationRequests = pgTable("translation_requests", {
  // ...existing fields...
  sourceLangId: integer("source_lang_id").references(() => languages.id),
  // targetLangs → separate junction table
});

export const translationRequestTargetLangs = pgTable(
  "translation_request_target_langs",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").references(() => translationRequests.id, { onDelete: "cascade" }).notNull(),
    languageId: integer("language_id").references(() => languages.id).notNull(),
  },
  (t) => [index("tr_target_langs_request_idx").on(t.requestId)],
);
```

#### `topicTranslationCache`
```typescript
export const topicTranslationCache = pgTable("topic_translation_cache", {
  // ...existing fields...
  sourceLangId: integer("source_lang_id").references(() => languages.id).notNull(),
  targetLangId: integer("target_lang_id").references(() => languages.id).notNull(),
  // remove: sourceLang, targetLang TEXT fields
});
```

---

## Files to Update

### Database Layer

| File | Changes |
|------|---------|
| `packages/adapters/db/src/schema.ts` | Add `languages`, junction tables; replace `*Lang` TEXT → `*LangId` FK |
| `packages/adapters/db/src/repositories/user.repository.ts` | Join `languages` table; resolve IDs ↔ codes |
| `packages/adapters/db/src/repositories/word.repository.ts` | Join `languages`; accept/return language codes |

### Core Layer

| File | Changes |
|------|---------|
| `packages/core/src/modules/translation/types.ts` | Keep `sourceLang: string` in DTOs (codes), resolve at repository |
| `packages/core/src/modules/translation/prompt.builder.ts` | No change (uses codes from DTOs) |
| `packages/core/src/modules/i18n/i18n.ts` | Load `SupportedLang` from DB or keep static for interface langs |

### Bot Layer

| File | Changes |
|------|---------|
| `packages/adapters/bot/src/scenes/onboarding.scene.ts` | Resolve language codes ↔ IDs via repository |
| `packages/adapters/bot/src/scenes/settings.scene.ts` | Same |
| `packages/adapters/bot/src/scenes/translate.scene.ts` | Same |

### Notifications

| File | Changes |
|------|---------|
| `packages/adapters/notifications/src/types.ts` | Keep codes in DTO; repository resolves |
| `packages/adapters/notifications/src/notification.service.ts` | No change if repository returns codes |

---

## Migration Strategy

### Phase 1: Add New Structure (non-breaking)

1. Create `languages` table
2. Seed with existing language codes:
   ```sql
   INSERT INTO languages (code, name) VALUES
     ('en', 'English'),
     ('ru', 'Russian'),
     ('cs', 'Czech'),
     ('de', 'German'),
     ('fr', 'French'),
     ('es', 'Spanish'),
     ('it', 'Italian'),
     ('uk', 'Ukrainian');
   ```
3. Add new `*_lang_id` columns (nullable initially)
4. Create junction tables

### Phase 2: Data Migration

```sql
-- Populate new FK columns from existing text columns
UPDATE user_language_settings u
SET interface_lang_id = (SELECT id FROM languages WHERE code = u.interface_lang),
    native_lang_id = (SELECT id FROM languages WHERE code = u.native_lang);

-- Populate junction table for learning languages
INSERT INTO user_learning_languages (user_id, language_id)
SELECT uls.user_id, l.id
FROM user_language_settings uls
CROSS JOIN LATERAL unnest(uls.learning_langs) AS lang_code
JOIN languages l ON l.code = lang_code;

-- Similar for words, translation_requests, topic_translation_cache
```

### Phase 3: Finalize

1. Make new FK columns `NOT NULL`
2. Drop old TEXT columns
3. Update all repository methods
4. Update indexes

---

## Repository Pattern

### Before (returns raw codes)
```typescript
async getUserSettings(telegramId: number) {
  const row = await db.query...;
  return {
    interfaceLang: row.interfaceLang,  // "en"
    nativeLang: row.nativeLang,        // "ru"
    learningLangs: row.learningLangs,  // ["cs", "de"]
  };
}
```

### After (joins languages, returns codes)
```typescript
async getUserSettings(telegramId: number) {
  const row = await db
    .select({
      interfaceLang: languages.code,
      nativeLang: sql`native_lang.code`,
      // learningLangs from junction
    })
    .from(userLanguageSettings)
    .innerJoin(languages, eq(languages.id, userLanguageSettings.interfaceLangId))
    .innerJoin(sql`languages AS native_lang`, ...)
    ...;
  
  return {
    interfaceLang: row.interfaceLang,  // "en" (resolved from FK)
    nativeLang: row.nativeLang,        // "ru"
    learningLangs: [...],              // from junction query
  };
}
```

---

## Benefits

1. **Referential Integrity** — FK constraints prevent invalid language codes
2. **Centralized Management** — Add/remove languages in one place
3. **Efficient Storage** — INTEGER FK vs repeated TEXT strings
4. **Extensibility** — Easy to add language metadata (flag emoji, RTL, etc.)
5. **Consistency** — Single source of truth for supported languages

---

## Implementation Checklist

- [x] Create `languages` table and seed data
- [ ] Create `userLearningLanguages` junction table
- [x] Create `translationRequestTargetLangs` junction table (Task 23)
- [ ] Add `*LangId` FK columns to existing tables (partially done: `translationRequests.sourceLangId` via Task 23)
- [ ] Write data migration script
- [ ] Update `user.repository.ts` — join languages, resolve codes
- [ ] Update `word.repository.ts` — same
- [x] Add `language.repository.ts` — `findByCode()`, `findAll()`, `getOrCreate()`, `create()` (already exists)
- [ ] Update bot scenes to use repository methods
- [ ] Update notification service types
- [ ] Drop old TEXT columns after verification
- [ ] Update tests
