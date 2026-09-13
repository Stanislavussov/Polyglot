CREATE TABLE "user_card_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"show_synonyms" boolean DEFAULT true NOT NULL,
	"show_example" boolean DEFAULT false NOT NULL,
	"show_hint" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_card_templates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user_card_templates" ADD CONSTRAINT "user_card_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;