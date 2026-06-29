-- Add Kazakh (kk) as a supported interface language.
-- Idempotent: ON CONFLICT DO UPDATE keeps re-runs safe and refreshes metadata.
-- is_supported = true means the language is available in the bot UI (language picker).
INSERT INTO "languages" ("code", "name", "native_name", "flag", "iso3_code", "is_supported", "localized_names")
VALUES
  ('kk', 'Kazakh', 'Қазақша', '🇰🇿', 'kaz', true, '{"ru":"Казахский","cs":"Kazaština"}')
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "native_name"     = EXCLUDED."native_name",
  "flag"            = EXCLUDED."flag",
  "iso3_code"       = EXCLUDED."iso3_code",
  "is_supported"    = EXCLUDED."is_supported",
  "localized_names" = EXCLUDED."localized_names";
