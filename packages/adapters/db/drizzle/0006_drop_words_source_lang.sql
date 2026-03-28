-- Migration 0006: Drop deprecated source_lang text column from words table.
-- source_lang_id FK (added in 0005) is now the single source of truth.

ALTER TABLE "words" DROP COLUMN IF EXISTS "source_lang";
