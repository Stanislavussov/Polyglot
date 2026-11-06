CREATE TABLE "word_pack_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pack_id" integer NOT NULL,
	"source_lang" text NOT NULL,
	"source_headword" text NOT NULL,
	"level" varchar(8) NOT NULL,
	"emoji" varchar(16),
	"headwords" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"emoji" varchar(16) DEFAULT '📦' NOT NULL,
	"title" varchar(120) NOT NULL,
	"title_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_dictionary_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "word_pack_items" ADD CONSTRAINT "word_pack_items_pack_id_word_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."word_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_packs" ADD CONSTRAINT "word_packs_source_dictionary_id_vocabulary_dictionaries_id_fk" FOREIGN KEY ("source_dictionary_id") REFERENCES "public"."vocabulary_dictionaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_packs" ADD CONSTRAINT "word_packs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wpki_pack_source_idx" ON "word_pack_items" USING btree ("pack_id","source_lang","source_headword");--> statement-breakpoint
CREATE UNIQUE INDEX "wpk_slug_idx" ON "word_packs" USING btree ("slug");