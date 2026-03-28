-- Migration 0005: Words Dictionary Improvements (FEAT-30)
--
-- Adds source_lang_id FK, input_type column, and dedup unique index to words table.
-- Deprecates source_lang text column (retained for backward compat; will be dropped in 0006).

-- Step 1: Add source_lang_id FK (nullable first for backfill)
ALTER TABLE "words" ADD COLUMN IF NOT EXISTS "source_lang_id" INTEGER REFERENCES "languages"("id");

-- Step 2: Add input_type column with CHECK constraint
ALTER TABLE "words" ADD COLUMN IF NOT EXISTS "input_type" TEXT NOT NULL DEFAULT 'word' CHECK (input_type IN ('word', 'phrase'));

-- Step 3: Backfill source_lang_id from existing source_lang text by joining languages.code
UPDATE "words" w SET "source_lang_id" = l."id"
FROM "languages" l
WHERE w."source_lang" = l."code"
  AND w."source_lang" IS NOT NULL
  AND w."source_lang_id" IS NULL;

-- Step 4: OPERATOR CHECK — verify no NULL source_lang_id rows remain before proceeding:
--   SELECT COUNT(*) FROM "words" WHERE "source_lang_id" IS NULL;
-- If count > 0, manually resolve missing language codes before running Step 5.

-- Step 5: Make source_lang_id NOT NULL after backfill
ALTER TABLE "words" ALTER COLUMN "source_lang_id" SET NOT NULL;

-- Step 6: Create dedup unique index (user + original + source language)
CREATE UNIQUE INDEX IF NOT EXISTS "words_user_original_sourcelangid_idx" ON "words" ("user_id", "original", "source_lang_id");

-- Step 7: Deprecate source_lang text column (drop NOT NULL, keep column for 0006)
ALTER TABLE "words" ALTER COLUMN "source_lang" DROP NOT NULL;

-- ─────────────────────────────────────────────
-- DOWN MIGRATION (run manually to rollback)
-- ─────────────────────────────────────────────
-- DROP INDEX IF EXISTS "words_user_original_sourcelangid_idx";
-- ALTER TABLE "words" ALTER COLUMN "source_lang" SET NOT NULL;
-- ALTER TABLE "words" DROP COLUMN IF EXISTS "input_type";
-- ALTER TABLE "words" DROP COLUMN IF EXISTS "source_lang_id";
