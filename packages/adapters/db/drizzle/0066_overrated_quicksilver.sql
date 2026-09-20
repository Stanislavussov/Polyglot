CREATE TYPE "public"."release_announcement_job_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "release_announcement_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"notes" jsonb NOT NULL,
	"audience_groups" text[] NOT NULL,
	"status" "release_announcement_job_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "release_announcement_jobs_status_idx" ON "release_announcement_jobs" USING btree ("status","id");