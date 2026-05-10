CREATE TABLE "reported_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_request_target_langs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"language_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_translation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text DEFAULT 'Custom' NOT NULL,
	"transcription" boolean DEFAULT true NOT NULL,
	"synonyms" boolean DEFAULT true NOT NULL,
	"examples" boolean DEFAULT true NOT NULL,
	"alternatives" boolean DEFAULT true NOT NULL,
	"equivalent_note" boolean DEFAULT true NOT NULL,
	"connotation_warning" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_translation_templates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "vocabulary_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"original" text NOT NULL,
	"source_lang_id" integer NOT NULL,
	"input_type" text DEFAULT 'word' NOT NULL,
	"emoji" text,
	"register" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"target_lang_id" integer NOT NULL,
	"text" text NOT NULL,
	"register" text,
	"transcription" text,
	"expression_type" text,
	"equivalent_note" text,
	"connotation_warning" text,
	"details" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_review_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"session_type" text NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "words" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "words" CASCADE;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "native_name" text;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "flag" text;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "is_supported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "languages" ADD COLUMN "localized_names" jsonb;--> statement-breakpoint
ALTER TABLE "translation_requests" ADD COLUMN "source_lang_id" integer;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "active_mode" text DEFAULT 'translate' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "last_source_lang" text;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "notification_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "notification_time" text DEFAULT '8' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "notification_type" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_settings" ADD COLUMN "last_interaction_at" timestamp;--> statement-breakpoint
ALTER TABLE "reported_issues" ADD CONSTRAINT "reported_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_request_target_langs" ADD CONSTRAINT "translation_request_target_langs_request_id_translation_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."translation_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_request_target_langs" ADD CONSTRAINT "translation_request_target_langs_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_translation_templates" ADD CONSTRAINT "user_translation_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD CONSTRAINT "vocabulary_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_entries" ADD CONSTRAINT "vocabulary_entries_source_lang_id_languages_id_fk" FOREIGN KEY ("source_lang_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD CONSTRAINT "vocabulary_translations_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD CONSTRAINT "vocabulary_translations_target_lang_id_languages_id_fk" FOREIGN KEY ("target_lang_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_review_log" ADD CONSTRAINT "word_review_log_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_review_log" ADD CONSTRAINT "word_review_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ri_user_id_idx" ON "reported_issues" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ri_status_idx" ON "reported_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tr_target_langs_request_idx" ON "translation_request_target_langs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tr_target_langs_unique_idx" ON "translation_request_target_langs" USING btree ("request_id","language_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_translation_templates_user_id_idx" ON "user_translation_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ve_user_id_idx" ON "vocabulary_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ve_user_original_sourcelang_idx" ON "vocabulary_entries" USING btree ("user_id","original","source_lang_id");--> statement-breakpoint
CREATE INDEX "vt_entry_id_idx" ON "vocabulary_translations" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "vt_target_lang_idx" ON "vocabulary_translations" USING btree ("target_lang_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vt_entry_lang_idx" ON "vocabulary_translations" USING btree ("entry_id","target_lang_id");--> statement-breakpoint
CREATE INDEX "word_review_log_entry_idx" ON "word_review_log" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "word_review_log_user_date_idx" ON "word_review_log" USING btree ("user_id","reviewed_at");--> statement-breakpoint
ALTER TABLE "translation_requests" ADD CONSTRAINT "translation_requests_source_lang_id_languages_id_fk" FOREIGN KEY ("source_lang_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_requests" DROP COLUMN "source_lang";--> statement-breakpoint
ALTER TABLE "translation_requests" DROP COLUMN "target_langs";