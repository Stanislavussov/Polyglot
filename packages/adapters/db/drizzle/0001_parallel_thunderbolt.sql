CREATE TABLE "languages" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "word_context" (
	"id" serial PRIMARY KEY NOT NULL,
	"word" text NOT NULL,
	"language_id" integer NOT NULL,
	"pos" text NOT NULL,
	"form_tags" text[] DEFAULT '{}',
	"glosses" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "word_context" ADD CONSTRAINT "word_context_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "languages_code_idx" ON "languages" USING btree ("code");--> statement-breakpoint
CREATE INDEX "word_context_word_lang_idx" ON "word_context" USING btree ("word","language_id");--> statement-breakpoint
CREATE INDEX "word_context_lang_idx" ON "word_context" USING btree ("language_id");
