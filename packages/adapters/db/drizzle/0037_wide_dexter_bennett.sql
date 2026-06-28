CREATE TABLE "dictionary_lookup_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"lookup_input" text NOT NULL,
	"normalized_input" text NOT NULL,
	"lang_code" text NOT NULL,
	"matched" boolean NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"matched_word" text,
	"match_type" text,
	"matched_pos" text,
	"matched_glosses" text[] DEFAULT '{}',
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dictionary_lookup_logs_created_at_idx" ON "dictionary_lookup_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dictionary_lookup_logs_lang_created_idx" ON "dictionary_lookup_logs" USING btree ("lang_code","created_at");--> statement-breakpoint
CREATE INDEX "dictionary_lookup_logs_matched_created_idx" ON "dictionary_lookup_logs" USING btree ("matched","created_at");