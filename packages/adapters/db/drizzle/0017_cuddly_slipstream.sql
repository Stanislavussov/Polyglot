ALTER TABLE "user_language_settings" ALTER COLUMN "notification_time" SET DEFAULT '08:00';--> statement-breakpoint
ALTER TABLE "vocabulary_entries" DROP COLUMN "register";--> statement-breakpoint
ALTER TABLE "vocabulary_translations" DROP COLUMN "register";