-- Convert notification_time from text slots ('morning'/'evening') to integer hours (0-23).
-- 'morning' → '8', 'evening' → '20', any other value → '8' (default).
UPDATE user_language_settings
SET notification_time = CASE
  WHEN notification_time = 'morning' THEN '8'
  WHEN notification_time = 'evening' THEN '20'
  ELSE '8'
END;
