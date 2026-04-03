-- Migration 0011: Drop legacy words table
-- Run ONLY after verifying migration 0010 was successful:
--   SELECT COUNT(*) FROM vocabulary_entries;  -- should match old words count
--   SELECT COUNT(*) FROM vocabulary_translations;  -- should be >= vocabulary_entries count

DROP TABLE IF EXISTS "words";
