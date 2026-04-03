-- Drop the cefr column from vocabulary_translations (CEFR level tracking removed from the product)
ALTER TABLE "vocabulary_translations" DROP COLUMN IF EXISTS "cefr";
