-- Add active_mode column to user_language_settings (idempotent)
ALTER TABLE "user_language_settings" ADD COLUMN IF NOT EXISTS "active_mode" text DEFAULT 'translate' NOT NULL;
