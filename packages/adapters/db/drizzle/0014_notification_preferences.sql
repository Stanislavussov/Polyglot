-- Add notification preference columns to user_language_settings (Task 41.1)
ALTER TABLE "user_language_settings" ADD COLUMN "notification_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "user_language_settings" ADD COLUMN "notification_time" text DEFAULT '08:00' NOT NULL;
ALTER TABLE "user_language_settings" ADD COLUMN "notification_type" text DEFAULT 'both' NOT NULL;
ALTER TABLE "user_language_settings" ADD COLUMN "last_interaction_at" timestamp;
