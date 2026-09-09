CREATE TABLE "tts_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"text_hash" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"lang_code" varchar(16) NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"voice" varchar(64) DEFAULT '' NOT NULL,
	"telegram_file_id" text NOT NULL,
	"char_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tts_cache_key_idx" ON "tts_cache" USING btree ("text_hash","lang_code","model_id","voice");--> statement-breakpoint
CREATE INDEX "tts_cache_last_used_idx" ON "tts_cache" USING btree ("last_used_at");