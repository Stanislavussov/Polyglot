# Task 13: Wiktionary JSONL Integration

## Overview

Integrate Wiktionary data from JSONL extracts (from [kaikki.org](https://kaikki.org/dictionary/)) to provide offline dictionary lookup, phrase detection, and translation enrichment.

## JSONL Format

Each line is a standalone JSON object representing a single dictionary entry.

### Sample Entries

```jsonl
{"pos": "phrase", "word": "что ли", "lang": "Russian", "lang_code": "ru", "forms": [{"form": "что́ ли", "tags": ["canonical"]}, {"form": "štó li", "tags": ["romanization"]}, {"form": "что́ ль", "tags": ["alternative"], "roman": "štó lʹ"}], "senses": [{"glosses": ["or something, perhaps, maybe, as if (or something like that - usually used in a question)"], "examples": [...]}], "sounds": [{"ipa": "[ˈʂto‿lʲɪ]"}]}

{"pos": "phrase", "word": "само собой разумеется", "lang": "Russian", "lang_code": "ru", "forms": [{"form": "само́ собо́й разуме́ется", "tags": ["canonical"]}, {"form": "samó sobój razuméjetsja", "tags": ["romanization"]}], "senses": [{"glosses": ["it goes without saying (it's obvious, apparent or clear)"], "synonyms": [{"word": "само́ собо́й"}, {"word": "разуме́ется"}]}]}

{"pos": "phrase", "word": "сорока на хвосте принесла", "lang": "Russian", "lang_code": "ru", "forms": [{"form": "соро́ка на хвосте́ принесла́", "tags": ["canonical"]}, {"form": "soróka na xvosté prineslá", "tags": ["romanization"]}], "senses": [{"glosses": ["a little bird told me"], "synonyms": [{"word": "слу́хом земля́ по́лнится"}]}], "etymology_text": "Literally, "a magpie brought it on its tail"."}
```

## Files location:

/Users/stanislav.ussov/Downloads/phrases

### Fields to Extract

| Field       | Path                  | Description                                                         |
| ----------- | --------------------- | ------------------------------------------------------------------- |
| `word`      | `.word`               | Dictionary headword (without stress marks)                          |
| `lang_code` | `.lang_code`          | ISO 639-1 language code (`ru`, `en`, `de`, etc.)                    |
| `pos`       | `.pos`                | Part of speech: `noun`, `verb`, `adj`, `phrase`, `idiom`, etc.      |
| `formTags`  | `.forms[0].tags[]`    | Tags for canonical form: `canonical`, `romanization`, `alternative` |
| `glosses`   | `.senses[].glosses[]` | English definitions/translations                                    |

### Full JSON Structure

```typescript
interface WiktionaryEntry {
  word: string; // "что ли"
  lang: string; // "Russian"
  lang_code: string; // "ru"
  pos: string; // "phrase", "noun", "verb", "adj", "idiom"

  forms: Array<{
    form: string; // "что́ ли" (with stress marks)
    tags: string[]; // ["canonical"], ["romanization"], ["alternative"]
    roman?: string; // Romanization if present
  }>;

  senses: Array<{
    glosses: string[]; // ["or something, perhaps, maybe..."]
    examples?: Array<{
      text: string; // Example in source language
      translation: string; // English translation
      roman?: string; // Romanization
    }>;
    synonyms?: Array<{ word: string }>;
    links?: string[][]; // Related terms
    tags?: string[]; // ["idiomatic", "colloquial", etc.]
  }>;

  sounds?: Array<{
    ipa?: string; // "[ˈʂto‿lʲɪ]"
    audio?: string; // Audio file name
  }>;

  etymology_text?: string; // Etymology explanation
}
```

---

## Database Schema

### Table: `languages`

Normalized lookup table for language codes.

```sql
CREATE TABLE languages (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,        -- "ru", "en", "de"
  name          TEXT NOT NULL,               -- "Russian", "English", "German"
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX languages_code_idx ON languages (code);
```

### Table: `word_context`

Word/phrase entries with definitions from Wiktionary.

```sql
CREATE TABLE word_context (
  id            SERIAL PRIMARY KEY,
  word          TEXT NOT NULL,               -- headword without stress marks
  language_id   INTEGER NOT NULL REFERENCES languages(id),
  pos           TEXT NOT NULL,               -- "phrase", "noun", "verb"
  form_tags     TEXT[] DEFAULT '{}',         -- ["canonical", "romanization"]
  glosses       TEXT[] DEFAULT '{}',         -- English definitions
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX word_context_word_lang_idx ON word_context (word, language_id);
CREATE INDEX word_context_lang_idx ON word_context (language_id);
```

### Drizzle Schema

Add to `packages/adapters/db/src/schema.ts`:

```typescript
// ─────────────────────────────────────────────
// Languages — normalized language codes
// ─────────────────────────────────────────────
export const languages = pgTable(
  "languages",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [uniqueIndex("languages_code_idx").on(t.code)],
);

// ─────────────────────────────────────────────
// Word context — offline dictionary data
// Imported from kaikki.org JSONL extracts
// ─────────────────────────────────────────────
export const wordContext = pgTable(
  "word_context",
  {
    id: serial("id").primaryKey(),
    word: text("word").notNull(),
    languageId: integer("language_id")
      .references(() => languages.id)
      .notNull(),
    pos: text("pos").notNull(),
    formTags: text("form_tags").array().default([]),
    glosses: text("glosses").array().default([]),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("word_context_word_lang_idx").on(t.word, t.languageId),
    index("word_context_lang_idx").on(t.languageId),
  ],
);
```

### Migration

Generate and apply migration:

```bash
cd packages/adapters/db
pnpm db:generate   # Creates migration file
pnpm db:migrate    # Applies to database
```

---

## JSONL Parsing Logic

```typescript
import { createReadStream } from "fs";
import { createInterface } from "readline";

interface ParsedEntry {
  word: string;
  langCode: string; // resolved to languageId during import
  pos: string;
  formTags: string[];
  glosses: string[];
}

async function* parseWiktionaryJsonl(
  filePath: string,
): AsyncGenerator<ParsedEntry> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    const entry = JSON.parse(line);

    yield {
      word: entry.word,
      langCode: entry.lang_code, // lookup languages.id by code
      pos: entry.pos,
      formTags: entry.forms?.[0]?.tags ?? [],
      glosses: entry.senses?.flatMap((s: any) => s.glosses ?? []) ?? [],
    };
  }
}

// Import workflow:
// 1. Ensure language exists: INSERT INTO languages (code, name) ... ON CONFLICT DO NOTHING
// 2. Get language_id: SELECT id FROM languages WHERE code = ?
// 3. Insert word_context with language_id
```

---

## Import Script (`packages/infra`)

Create a CLI script in the `infra` package to parse JSONL files and bulk insert into the database.

### Package Structure

```
packages/infra/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── scripts/
│       └── import-wiktionary.ts
```

### Script: `import-wiktionary.ts`

```typescript
#!/usr/bin/env tsx
/**
 * Import Wiktionary JSONL data into word_context table.
 *
 * Usage:
 *   pnpm import:wiktionary <jsonl-file> [--batch-size=1000] [--lang=ru]
 *
 * Examples:
 *   pnpm import:wiktionary ./data/kaikki.org-dictionary-Russian.jsonl
 *   pnpm import:wiktionary ./data/russian.jsonl --batch-size=5000
 *   pnpm import:wiktionary ./data/russian.jsonl --lang=ru
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";
import { parseArgs } from "util";
import { db } from "@polyglot/db";
import { languages, wordContext } from "@polyglot/db/schema";
import { eq } from "drizzle-orm";

interface ParsedEntry {
  word: string;
  langCode: string;
  langName: string;
  pos: string;
  formTags: string[];
  glosses: string[];
}

interface ImportStats {
  total: number;
  inserted: number;
  skipped: number;
  errors: number;
  duration: number;
}

// ─────────────────────────────────────────────
// JSONL Parser (streaming)
// ─────────────────────────────────────────────
async function* parseJsonl(filePath: string): AsyncGenerator<ParsedEntry> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Skip entries without required fields
      if (!entry.word || !entry.lang_code || !entry.pos) continue;

      yield {
        word: entry.word,
        langCode: entry.lang_code,
        langName: entry.lang ?? entry.lang_code,
        pos: entry.pos,
        formTags: entry.forms?.[0]?.tags ?? [],
        glosses: entry.senses?.flatMap((s: any) => s.glosses ?? []) ?? [],
      };
    } catch (err) {
      // Skip malformed JSON lines
      continue;
    }
  }
}

// ─────────────────────────────────────────────
// Language Resolution (with cache)
// ─────────────────────────────────────────────
const languageCache = new Map<string, number>();

async function getOrCreateLanguageId(
  code: string,
  name: string,
): Promise<number> {
  // Check cache first
  if (languageCache.has(code)) {
    return languageCache.get(code)!;
  }

  // Try to find existing
  const existing = await db
    .select({ id: languages.id })
    .from(languages)
    .where(eq(languages.code, code))
    .limit(1);

  if (existing.length > 0) {
    languageCache.set(code, existing[0].id);
    return existing[0].id;
  }

  // Insert new language
  const [inserted] = await db
    .insert(languages)
    .values({ code, name })
    .onConflictDoNothing()
    .returning({ id: languages.id });

  if (inserted) {
    languageCache.set(code, inserted.id);
    return inserted.id;
  }

  // Race condition: another process inserted, fetch again
  const [refetched] = await db
    .select({ id: languages.id })
    .from(languages)
    .where(eq(languages.code, code))
    .limit(1);

  languageCache.set(code, refetched.id);
  return refetched.id;
}

// ─────────────────────────────────────────────
// Batch Insert
// ─────────────────────────────────────────────
async function insertBatch(
  batch: Array<{
    word: string;
    languageId: number;
    pos: string;
    formTags: string[];
    glosses: string[];
  }>,
): Promise<number> {
  if (batch.length === 0) return 0;

  const result = await db
    .insert(wordContext)
    .values(batch)
    .onConflictDoNothing();

  return batch.length;
}

// ─────────────────────────────────────────────
// Main Import Function
// ─────────────────────────────────────────────
async function importWiktionary(
  filePath: string,
  options: { batchSize: number; langFilter?: string },
): Promise<ImportStats> {
  const startTime = Date.now();
  const stats: ImportStats = {
    total: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    duration: 0,
  };

  const batch: Array<{
    word: string;
    languageId: number;
    pos: string;
    formTags: string[];
    glosses: string[];
  }> = [];

  console.log(`📖 Importing from: ${filePath}`);
  console.log(`📦 Batch size: ${options.batchSize}`);
  if (options.langFilter) {
    console.log(`🌍 Language filter: ${options.langFilter}`);
  }
  console.log("");

  for await (const entry of parseJsonl(filePath)) {
    stats.total++;

    // Apply language filter if specified
    if (options.langFilter && entry.langCode !== options.langFilter) {
      stats.skipped++;
      continue;
    }

    try {
      const languageId = await getOrCreateLanguageId(
        entry.langCode,
        entry.langName,
      );

      batch.push({
        word: entry.word,
        languageId,
        pos: entry.pos,
        formTags: entry.formTags,
        glosses: entry.glosses,
      });

      // Flush batch when full
      if (batch.length >= options.batchSize) {
        const inserted = await insertBatch(batch);
        stats.inserted += inserted;
        batch.length = 0;

        // Progress indicator
        process.stdout.write(
          `\r⏳ Processed: ${stats.total.toLocaleString()} | Inserted: ${stats.inserted.toLocaleString()}`,
        );
      }
    } catch (err) {
      stats.errors++;
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    const inserted = await insertBatch(batch);
    stats.inserted += inserted;
  }

  stats.duration = Date.now() - startTime;

  console.log(`\r✅ Complete!                                        `);
  console.log("");
  console.log(`📊 Stats:`);
  console.log(`   Total entries:  ${stats.total.toLocaleString()}`);
  console.log(`   Inserted:       ${stats.inserted.toLocaleString()}`);
  console.log(`   Skipped:        ${stats.skipped.toLocaleString()}`);
  console.log(`   Errors:         ${stats.errors.toLocaleString()}`);
  console.log(`   Duration:       ${(stats.duration / 1000).toFixed(2)}s`);

  return stats;
}

// ─────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "batch-size": { type: "string", default: "1000" },
      lang: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Usage: pnpm import:wiktionary <jsonl-file> [options]

Options:
  --batch-size=N   Insert batch size (default: 1000)
  --lang=CODE      Filter by language code (e.g., ru, en, de)
  -h, --help       Show this help message

Examples:
  pnpm import:wiktionary ./data/kaikki.org-dictionary-Russian.jsonl
  pnpm import:wiktionary ./data/russian.jsonl --batch-size=5000
  pnpm import:wiktionary ./data/russian.jsonl --lang=ru
`);
    process.exit(0);
  }

  const filePath = positionals[0];
  const batchSize = parseInt(values["batch-size"] ?? "1000", 10);
  const langFilter = values.lang;

  try {
    await importWiktionary(filePath, { batchSize, langFilter });
    process.exit(0);
  } catch (err) {
    console.error("❌ Import failed:", err);
    process.exit(1);
  }
}

main();
```

### Package.json Scripts

Add to `packages/infra/package.json`:

```json
{
  "name": "@polyglot/infra",
  "type": "module",
  "scripts": {
    "import:wiktionary": "tsx src/scripts/import-wiktionary.ts"
  },
  "dependencies": {
    "@polyglot/db": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.7.0"
  }
}
```

### Usage

```bash
# From packages/infra directory
pnpm import:wiktionary ./data/kaikki.org-dictionary-Russian.jsonl

# With options
pnpm import:wiktionary ./data/russian.jsonl --batch-size=5000 --lang=ru

# From monorepo root
pnpm --filter @polyglot/infra import:wiktionary ./data/russian.jsonl
```

---

## Use Cases

1. **Offline Lookup** — Fast word/phrase lookup without AI calls
2. **Phrase Detection** — Identify multi-word expressions (idioms, collocations)
3. **Translation Enrichment** — Supplement AI translations with Wiktionary glosses
4. **POS Filtering** — Filter by part of speech (`phrase`, `idiom`, `verb`, etc.)

---

## Data Source

Download JSONL extracts from:

- **Russian**: https://kaikki.org/dictionary/Russian/
- **Other languages**: https://kaikki.org/dictionary/

Files are named like `kaikki.org-dictionary-Russian.jsonl`.

---

## Implementation Checklist

- [x] Add `languages` table to Drizzle schema
- [x] Add `wordContext` table to Drizzle schema (references `languages`)
- [x] Generate and apply migration
- [x] Create `packages/infra` package
- [x] Implement `import-wiktionary.ts` script with:
  - [x] Streaming JSONL parser
  - [x] Language resolution with cache
  - [x] Batch insert with progress indicator
  - [x] CLI argument parsing (`--batch-size`, `--lang`)
- [x] Add `import:wiktionary` script to package.json
- [x] Add repository methods for `wordContext` lookup
- [x] Integrate with translation pipeline (DictionaryContext type, prompt enrichment, passthrough in translate/translateOne, 27 tests)
- [x] Integrate with topics layer (lookupDictionaryContext dep, batch context lookup, fail-open, 20 tests)
- [x] Add i18n keys for Wiktionary dictionary context (wiktionaryDefinition, wiktionarySource, partOfSpeech, phraseDetected, idiomDetected, dictionaryContext) in en, ru, cs locale files
- [x] Add language name registry (`getLanguageName`, `getLanguageNativeName`, `getAllLanguageNames`, `isKnownLanguage`) for language code → name resolution
- [x] Add validation layer: `validateWiktionaryEntry()`, `validateWordContext()`, `validateGlosses()`, `validatePos()` with 58 tests
- [x] Integrate with notifications layer (lookupDictionaryContext dep, fail-open dictionary context in pickSuggestedWord, optional DictionaryContext on SuggestedWord, 12 tests)
- [x] Integrate with bot layer (dictionary context lookup via context-enrichment layer, fail-open; dictionary context is AI-prompt-only — not rendered in Telegram card)

### Files created/modified

- `packages/adapters/db/src/schema.ts` — Added `languages` and `wordContext` Drizzle table definitions
- `packages/adapters/db/src/index.ts` — Re-exports languageRepository, wordContextRepository, and types
- `packages/adapters/db/src/repositories/language.repository.ts` — findByCode, create, getOrCreate, findAll
- `packages/adapters/db/src/repositories/word-context.repository.ts` — findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById
- `packages/adapters/db/src/__tests__/language.repository.test.ts` — 7 tests
- `packages/adapters/db/src/__tests__/word-context.repository.test.ts` — 13 tests
- `packages/adapters/db/drizzle/0001_parallel_thunderbolt.sql` — Migration for languages, word_context, topic_translation_cache
- `packages/adapters/db/tsconfig.json` — Exclude __tests__ from build
- `packages/infra/package.json` — Added @polyglot/adapter-db dependency, import:wiktionary script, tsx devDep
- `packages/infra/src/scripts/import-wiktionary.ts` — Streaming JSONL import CLI with --batch-size, --lang flags
- `packages/core/src/modules/i18n/language-registry.ts` — Language registry (60+ languages with English, native, and localized names; ISO code mapping; flag/display helpers)
- `packages/core/src/modules/i18n/types.ts` — Added 6 new I18nKey values, 3 new I18nParams entries
- `packages/core/src/modules/i18n/index.ts` — Re-exports language name utilities
- `packages/core/src/modules/i18n/locales/en.json` — 6 new Wiktionary keys
- `packages/core/src/modules/i18n/locales/ru.json` — 6 new Wiktionary keys (Russian)
- `packages/core/src/modules/i18n/locales/cs.json` — 6 new Wiktionary keys (Czech)
- `packages/core/src/modules/i18n/__tests__/language-names.test.ts` — 19 tests
- `packages/core/src/modules/i18n/__tests__/i18n.test.ts` — Updated with 10 new Wiktionary key tests (59 total)
- `packages/core/src/modules/validation/validators/wiktionary.validator.ts` — 4 Wiktionary validators + KNOWN_POS constant + types
- `packages/core/src/modules/validation/__tests__/wiktionary.validator.test.ts` — 58 tests (21 entry + 19 wordContext + 8 glosses + 10 pos)
- `packages/core/src/modules/validation/index.ts` — Re-exports Wiktionary validators and types
- `packages/core/src/modules/translation/types.ts` — Added DictionaryContext type, optional dictionaryContext on TranslateInput/TranslateOutput/TranslationRequest
- `packages/core/src/modules/translation/prompt.builder.ts` — Added buildDictionaryHint(), dictionary context enrichment in buildTranslationPrompt()
- `packages/core/src/modules/translation/translation.service.ts` — Pass dictionaryContext through translate()/translateOne()/toOutput()
- `packages/core/src/modules/translation/index.ts` — Re-export DictionaryContext type
- `packages/core/src/modules/translation/__tests__/dictionary-context.test.ts` — 27 tests for dictionary context integration
- `.pi/skills/translation/SKILL.md` — Updated with DictionaryContext type, enrichment flow, new test file
- `packages/core/src/modules/topics/types.ts` — Added DictionaryContext import, lookupDictionaryContext to TopicDeps, updated translateBatch/translateOne signatures with optional dictionary context params
- `packages/core/src/modules/topics/topic.service.ts` — Added lookupContextsBatch helper, wired dictionary context into getTopicWords, regenerateTopicWord, generateCustomTopic (fail-open, parallel lookups)
- `packages/core/src/modules/topics/__tests__/dictionary-context.test.ts` — 20 tests for dictionary context integration (batch lookup, passthrough, fail-open, backward compat, partial cache)
- `.pi/skills/topics/SKILL.md` — Updated with dictionary context integration, new deps, file structure, data flow diagram
- `packages/adapters/notifications/src/types.ts` — Added lookupDictionaryContext to NotificationServiceDeps, optional DictionaryContext on SuggestedWord
- `packages/adapters/notifications/src/notification.service.ts` — Wiktionary dictionary context lookup in pickSuggestedWord (fail-open)
- `packages/adapters/notifications/src/dictionary-context.test.ts` — 12 tests for dictionary context integration (happy path, no-context, fail-open, backward compat)
- `.pi/skills/notifications/SKILL.md` — Updated with dictionary context integration, data flow diagram, updated types and file structure
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — Added lookupDictContext(), wired dictionaryContext into translate() call
- `apps/bot/src/scenes/helpers/translate-mode.helper.test.ts` — 9 tests (dict context lookup + wiring)
- `apps/bot/src/renderers/translation.renderer.ts` — Dictionary context is explicitly not rendered (AI-prompt-only); comment documents this
- `apps/bot/src/__tests__/dictionary-context-renderer.test.ts` — 6 tests (verifies dictionary context is NOT rendered in user-facing card)
- `.pi/skills/bot/SKILL.md` — Updated with dictionary context integration, new functions, file structure
