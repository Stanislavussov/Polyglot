CREATE TABLE "word_picker_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"word" text NOT NULL,
	"native_translation" text NOT NULL,
	"emoji" varchar(16),
	"item_type" text,
	"level" varchar(8),
	"example_target" text,
	"example_native" text,
	"note" text,
	"sort_order" integer NOT NULL,
	"saved_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_picker_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"emoji" varchar(16) DEFAULT '✨' NOT NULL,
	"title" varchar(120) NOT NULL,
	"title_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt" text NOT NULL,
	"learning_langs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_picker_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"preset_id" integer,
	"preset_title" varchar(120) NOT NULL,
	"preset_emoji" varchar(16) DEFAULT '✨' NOT NULL,
	"lang_code" text NOT NULL,
	"native_lang" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "word_picker_items" ADD CONSTRAINT "word_picker_items_run_id_word_picker_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."word_picker_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_picker_items" ADD CONSTRAINT "word_picker_items_saved_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("saved_entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_picker_runs" ADD CONSTRAINT "word_picker_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_picker_runs" ADD CONSTRAINT "word_picker_runs_preset_id_word_picker_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."word_picker_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wpi_run_sort_idx" ON "word_picker_items" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "wpp_slug_idx" ON "word_picker_presets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "wpp_active_order_idx" ON "word_picker_presets" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "wpr_user_preset_idx" ON "word_picker_runs" USING btree ("user_id","preset_id","lang_code");