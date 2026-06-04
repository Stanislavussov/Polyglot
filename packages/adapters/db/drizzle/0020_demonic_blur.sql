ALTER TABLE "vocabulary_translations" ADD COLUMN "srs_ease_factor" real DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD COLUMN "srs_interval" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD COLUMN "srs_due_date" timestamp;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD COLUMN "srs_review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "vt_srs_due_idx" ON "vocabulary_translations" USING btree ("srs_due_date");