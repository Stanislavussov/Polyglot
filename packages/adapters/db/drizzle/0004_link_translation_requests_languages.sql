-- Task 23: Link translation_requests to languages table
-- Step 1: Add new FK column (nullable)
ALTER TABLE "translation_requests" ADD COLUMN IF NOT EXISTS "source_lang_id" integer REFERENCES "languages"("id");

-- Step 2: Create junction table for target languages
CREATE TABLE IF NOT EXISTS "translation_request_target_langs" (
  "id" serial PRIMARY KEY,
  "request_id" integer NOT NULL REFERENCES "translation_requests"("id") ON DELETE CASCADE,
  "language_id" integer NOT NULL REFERENCES "languages"("id")
);

-- Step 3: Indexes on junction table
CREATE INDEX IF NOT EXISTS "tr_target_langs_request_idx" ON "translation_request_target_langs" ("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tr_target_langs_unique_idx" ON "translation_request_target_langs" ("request_id", "language_id");

-- Step 4: Migrate existing data — populate source_lang_id from text column
UPDATE "translation_requests" tr
SET "source_lang_id" = l."id"
FROM "languages" l
WHERE tr."source_lang" = l."code"
  AND tr."source_lang" IS NOT NULL
  AND tr."source_lang_id" IS NULL;

-- Step 5: Migrate existing data — populate junction table from text[] column
INSERT INTO "translation_request_target_langs" ("request_id", "language_id")
SELECT tr."id", l."id"
FROM "translation_requests" tr
CROSS JOIN LATERAL unnest(tr."target_langs") AS target_code
JOIN "languages" l ON l."code" = target_code
WHERE tr."target_langs" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 6: Drop old columns
ALTER TABLE "translation_requests" DROP COLUMN IF EXISTS "source_lang";
ALTER TABLE "translation_requests" DROP COLUMN IF EXISTS "target_langs";
