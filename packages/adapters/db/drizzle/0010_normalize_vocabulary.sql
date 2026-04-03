-- Migration 0010: Normalize Vocabulary Schema
-- Replaces monolithic words.content JSONB with two normalized tables:
--   vocabulary_entries  — one row per saved word/phrase per user
--   vocabulary_translations — one row per target language per entry

-- Step 1: Create vocabulary_entries table
CREATE TABLE IF NOT EXISTS "vocabulary_entries" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "original" text NOT NULL,
  "source_lang_id" integer NOT NULL REFERENCES "languages"("id"),
  "input_type" text NOT NULL DEFAULT 'word',
  "emoji" text,
  "register" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ve_user_id_idx" ON "vocabulary_entries" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ve_user_original_sourcelang_idx" ON "vocabulary_entries" ("user_id", "original", "source_lang_id");

-- Step 2: Create vocabulary_translations table
CREATE TABLE IF NOT EXISTS "vocabulary_translations" (
  "id" serial PRIMARY KEY,
  "entry_id" integer NOT NULL REFERENCES "vocabulary_entries"("id") ON DELETE CASCADE,
  "target_lang_id" integer NOT NULL REFERENCES "languages"("id"),
  "text" text NOT NULL,
  "cefr" text,
  "register" text,
  "transcription" text,
  "expression_type" text,
  "equivalent_note" text,
  "connotation_warning" text,
  "details" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vt_entry_id_idx" ON "vocabulary_translations" ("entry_id");
CREATE INDEX IF NOT EXISTS "vt_target_lang_idx" ON "vocabulary_translations" ("target_lang_id");
CREATE UNIQUE INDEX IF NOT EXISTS "vt_entry_lang_idx" ON "vocabulary_translations" ("entry_id", "target_lang_id");

-- Step 3: Migrate data from words → vocabulary_entries
-- Safe to run on empty DB (INSERT ... SELECT returns 0 rows)
INSERT INTO "vocabulary_entries" ("user_id", "original", "source_lang_id", "input_type", "emoji", "register", "is_active", "created_at", "updated_at")
SELECT "user_id", "original", "source_lang_id", "input_type",
       "content"->>'emoji',
       "content"->>'register',
       "is_active", "created_at", "updated_at"
FROM "words"
ON CONFLICT ("user_id", "original", "source_lang_id") DO NOTHING;

-- Step 4: Migrate translations → vocabulary_translations
-- For each word, extract each key from content->'translations' as a separate row
INSERT INTO "vocabulary_translations" ("entry_id", "target_lang_id", "text", "cefr", "register", "transcription", "expression_type", "equivalent_note", "connotation_warning", "details", "is_active", "created_at", "updated_at")
SELECT ve."id", l."id",
       t.value->>'text',
       t.value->>'cefr',
       t.value->>'register',
       t.value->>'transcription',
       t.value->>'expressionType',
       t.value->>'equivalentNote',
       t.value->>'connotationWarning',
       jsonb_build_object(
         'synonyms', COALESCE(t.value->'synonyms', '[]'::jsonb),
         'examples', COALESCE(t.value->'examples', '[]'::jsonb),
         'alternatives', t.value->'alternatives'
       ),
       ve."is_active",
       ve."created_at",
       ve."updated_at"
FROM "words" w
JOIN "vocabulary_entries" ve ON ve."user_id" = w."user_id"
  AND ve."original" = w."original"
  AND ve."source_lang_id" = w."source_lang_id"
CROSS JOIN LATERAL jsonb_each(w."content"->'translations') AS t(key, value)
JOIN "languages" l ON l."code" = t.key
ON CONFLICT ("entry_id", "target_lang_id") DO NOTHING;

-- Verification queries (run manually):
-- SELECT COUNT(*) FROM vocabulary_entries;  -- should match: SELECT COUNT(*) FROM words;
-- SELECT COUNT(*) FROM vocabulary_translations;  -- should be >= vocabulary_entries count (one per lang per word)

-- Down migration (rollback):
-- DROP TABLE IF EXISTS "vocabulary_translations";
-- DROP TABLE IF EXISTS "vocabulary_entries";
