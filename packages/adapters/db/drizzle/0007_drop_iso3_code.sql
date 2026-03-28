-- Drop iso3_code column from languages table.
--
-- ISO 639-3 codes were only used for franc language detection.
-- They are now a hardcoded constant in detect-language.ts (core).
-- The mapping is a universal standard — no reason to store it in the DB.
ALTER TABLE "languages" DROP COLUMN IF EXISTS "iso3_code";
