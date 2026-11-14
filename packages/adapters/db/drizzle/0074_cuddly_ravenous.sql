CREATE TABLE "article_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_process_id" integer NOT NULL,
	"phrase" text NOT NULL,
	"native_translation" text,
	"emoji" text,
	"phrase_type" text,
	"level" text,
	"context" text,
	"sort_order" integer NOT NULL,
	"saved_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"site_name" text,
	"language" text NOT NULL,
	"content" text NOT NULL,
	"word_count" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_phrases" ADD CONSTRAINT "article_phrases_article_process_id_article_processes_id_fk" FOREIGN KEY ("article_process_id") REFERENCES "public"."article_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_phrases" ADD CONSTRAINT "article_phrases_saved_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("saved_entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_processes" ADD CONSTRAINT "article_processes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aph_process_sort_idx" ON "article_phrases" USING btree ("article_process_id","sort_order");--> statement-breakpoint
CREATE INDEX "ap_user_created_idx" ON "article_processes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ap_user_url_idx" ON "article_processes" USING btree ("user_id","url");