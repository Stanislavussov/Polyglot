CREATE TABLE "user_learning_languages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"language_code" text NOT NULL,
	"proficiency_level" text DEFAULT 'B1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_process_id" integer NOT NULL,
	"phrase" text NOT NULL,
	"native_translation" text,
	"emoji" text,
	"phrase_type" text,
	"level" text,
	"context" text,
	"timestamp_seconds" integer,
	"sort_order" integer NOT NULL,
	"saved_entry_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"video_id" text NOT NULL,
	"video_url" text NOT NULL,
	"title" text,
	"duration_seconds" integer,
	"language" text NOT NULL,
	"transcript_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_transcript_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"language" text NOT NULL,
	"transcript" text NOT NULL,
	"transcript_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "user_learning_languages" ADD CONSTRAINT "user_learning_languages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_phrases" ADD CONSTRAINT "video_phrases_video_process_id_video_processes_id_fk" FOREIGN KEY ("video_process_id") REFERENCES "public"."video_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_phrases" ADD CONSTRAINT "video_phrases_saved_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("saved_entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_processes" ADD CONSTRAINT "video_processes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ull_user_lang_idx" ON "user_learning_languages" USING btree ("user_id","language_code");--> statement-breakpoint
CREATE INDEX "ull_user_id_idx" ON "user_learning_languages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vph_process_sort_idx" ON "video_phrases" USING btree ("video_process_id","sort_order");--> statement-breakpoint
CREATE INDEX "vp_user_id_idx" ON "video_processes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vp_video_lang_idx" ON "video_processes" USING btree ("video_id","language");--> statement-breakpoint
CREATE INDEX "vp_user_status_idx" ON "video_processes" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vtc_video_lang_idx" ON "video_transcript_cache" USING btree ("video_id","language");