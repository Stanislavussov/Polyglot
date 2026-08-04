CREATE TABLE "onboarding_demo_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_lang" text NOT NULL,
	"native_lang" text NOT NULL,
	"headword" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_demo_cards_key_idx" ON "onboarding_demo_cards" USING btree ("source_lang","native_lang","headword");