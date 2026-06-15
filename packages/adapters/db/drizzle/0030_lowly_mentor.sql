CREATE TABLE "vocabulary_dictionaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_dictionary_entries" (
	"dictionary_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_dictionary_entries_dictionary_id_entry_id_pk" PRIMARY KEY("dictionary_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "vocabulary_dictionaries" ADD CONSTRAINT "vocabulary_dictionaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_dictionary_entries" ADD CONSTRAINT "vocabulary_dictionary_entries_dictionary_id_vocabulary_dictionaries_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."vocabulary_dictionaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_dictionary_entries" ADD CONSTRAINT "vocabulary_dictionary_entries_entry_id_vocabulary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vocabulary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vd_user_id_idx" ON "vocabulary_dictionaries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vd_user_name_idx" ON "vocabulary_dictionaries" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "vde_entry_id_idx" ON "vocabulary_dictionary_entries" USING btree ("entry_id");