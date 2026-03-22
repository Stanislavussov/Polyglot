-- Add metadata columns to languages table (idempotent — db:push handles schema)
ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "native_name" text;
ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "flag" text;
ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "iso3_code" text;
ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "is_supported" boolean DEFAULT false NOT NULL;
ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "localized_names" jsonb;

-- Seed all known languages with full metadata.
-- ON CONFLICT DO UPDATE ensures re-runs update existing rows.
-- is_supported = true means the language is available in the bot UI.
INSERT INTO "languages" ("code", "name", "native_name", "flag", "iso3_code", "is_supported", "localized_names")
VALUES
  -- Supported bot languages (is_supported = true)
  ('en', 'English',    'English',     '🇬🇧', 'eng', true,  '{"ru":"Английский","cs":"Angličtina"}'),
  ('ru', 'Russian',    'Русский',     '🇷🇺', 'rus', true,  '{"ru":"Русский","cs":"Ruština"}'),
  ('cs', 'Czech',      'Čeština',     '🇨🇿', 'ces', true,  '{"ru":"Чешский","cs":"Čeština"}'),
  ('de', 'German',     'Deutsch',     '🇩🇪', 'deu', true,  '{"ru":"Немецкий","cs":"Němčina"}'),
  ('fr', 'French',     'Français',    '🇫🇷', 'fra', true,  '{"ru":"Французский","cs":"Francouzština"}'),
  ('es', 'Spanish',    'Español',     '🇪🇸', 'spa', true,  '{"ru":"Испанский","cs":"Španělština"}'),
  ('it', 'Italian',    'Italiano',    '🇮🇹', 'ita', true,  '{"ru":"Итальянский","cs":"Italština"}'),
  ('pt', 'Portuguese', 'Português',   '🇵🇹', 'por', true,  '{"ru":"Португальский","cs":"Portugalština"}'),
  ('uk', 'Ukrainian',  'Українська',  '🇺🇦', 'ukr', true,  '{"ru":"Украинский","cs":"Ukrajinština"}'),
  ('pl', 'Polish',     'Polski',      '🇵🇱', 'pol', true,  '{"ru":"Польский","cs":"Polština"}'),
  -- Additional Wiktionary / detection languages (is_supported = false)
  ('ja', 'Japanese',   '日本語',       '🇯🇵', 'jpn', false, '{"ru":"Японский","cs":"Japonština"}'),
  ('zh', 'Chinese',    '中文',         '🇨🇳', 'cmn', false, '{"ru":"Китайский","cs":"Čínština"}'),
  ('ko', 'Korean',     '한국어',       '🇰🇷', 'kor', false, '{"ru":"Корейский","cs":"Korejština"}'),
  ('ar', 'Arabic',     'العربية',     '🇸🇦', 'arb', false, '{"ru":"Арабский","cs":"Arabština"}'),
  ('hi', 'Hindi',      'हिन्दी',       '🇮🇳', 'hin', false, '{"ru":"Хинди","cs":"Hindština"}'),
  ('tr', 'Turkish',    'Türkçe',      '🇹🇷', 'tur', false, '{"ru":"Турецкий","cs":"Turečtina"}'),
  ('nl', 'Dutch',      'Nederlands',  '🇳🇱', 'nld', false, '{"ru":"Нидерландский","cs":"Nizozemština"}'),
  ('sv', 'Swedish',    'Svenska',     '🇸🇪', 'swe', false, '{"ru":"Шведский","cs":"Švédština"}'),
  ('da', 'Danish',     'Dansk',       '🇩🇰', 'dan', false, '{"ru":"Датский","cs":"Dánština"}'),
  ('no', 'Norwegian',  'Norsk',       '🇳🇴', 'nob', false, '{"ru":"Норвежский","cs":"Norština"}'),
  ('fi', 'Finnish',    'Suomi',       '🇫🇮', 'fin', false, '{"ru":"Финский","cs":"Finština"}'),
  ('el', 'Greek',      'Ελληνικά',    '🇬🇷', 'ell', false, '{"ru":"Греческий","cs":"Řečtina"}'),
  ('hu', 'Hungarian',  'Magyar',      '🇭🇺', 'hun', false, NULL),
  ('ro', 'Romanian',   'Română',      '🇷🇴', 'ron', false, NULL),
  ('bg', 'Bulgarian',  'Български',   '🇧🇬', 'bul', false, NULL),
  ('hr', 'Croatian',   'Hrvatski',    '🇭🇷', 'hrv', false, NULL),
  ('sk', 'Slovak',     'Slovenčina',  '🇸🇰', 'slk', false, NULL),
  ('sl', 'Slovenian',  'Slovenščina', '🇸🇮', 'slv', false, NULL),
  ('sr', 'Serbian',    'Српски',      '🇷🇸', 'srp', false, NULL),
  ('lt', 'Lithuanian', 'Lietuvių',    '🇱🇹', 'lit', false, NULL),
  ('lv', 'Latvian',    'Latviešu',    '🇱🇻', 'lav', false, NULL),
  ('et', 'Estonian',   'Eesti',       '🇪🇪', 'est', false, NULL),
  ('he', 'Hebrew',     'עברית',       '🇮🇱', NULL,  false, '{"ru":"Иврит","cs":"Hebrejština"}'),
  ('th', 'Thai',       'ไทย',         '🇹🇭', NULL,  false, NULL),
  ('vi', 'Vietnamese', 'Tiếng Việt',  '🇻🇳', NULL,  false, NULL),
  ('ka', 'Georgian',   'ქართული',     '🇬🇪', NULL,  false, NULL),
  ('id', 'Indonesian', 'Bahasa Indonesia', '🇮🇩', NULL, false, NULL),
  ('la', 'Latin',      'Latina',      NULL,   NULL,  false, '{"ru":"Латинский","cs":"Latina"}'),
  ('af', 'Afrikaans',  'Afrikaans',   '🇿🇦', NULL,  false, NULL),
  ('ca', 'Catalan',    'Català',      NULL,   NULL,  false, NULL),
  ('sq', 'Albanian',   'Shqip',       '🇦🇱', NULL,  false, NULL),
  ('mk', 'Macedonian', 'Македонски',  '🇲🇰', NULL,  false, NULL),
  ('be', 'Belarusian', 'Беларуская',  '🇧🇾', NULL,  false, NULL),
  ('fa', 'Persian',    'فارسی',       '🇮🇷', NULL,  false, NULL),
  ('sw', 'Swahili',    'Kiswahili',   '🇹🇿', NULL,  false, NULL)
ON CONFLICT ("code") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "native_name"     = EXCLUDED."native_name",
  "flag"            = EXCLUDED."flag",
  "iso3_code"       = EXCLUDED."iso3_code",
  "is_supported"    = EXCLUDED."is_supported",
  "localized_names" = EXCLUDED."localized_names";
