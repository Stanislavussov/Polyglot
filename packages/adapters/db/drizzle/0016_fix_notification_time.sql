UPDATE "user_language_settings" SET "notification_time" = '08:00' WHERE "notification_time" = 'morning';
UPDATE "user_language_settings" SET "notification_time" = '20:00' WHERE "notification_time" = 'evening';
UPDATE "user_language_settings" SET "notification_time" = '08:00' WHERE "notification_time" = '8';
ALTER TABLE "user_language_settings" ALTER COLUMN "notification_time" SET DEFAULT '08:00';
