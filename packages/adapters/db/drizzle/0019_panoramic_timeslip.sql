ALTER TABLE "user_language_settings" ALTER COLUMN "notification_type" SET DEFAULT 'srs';--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "notification_context" text;