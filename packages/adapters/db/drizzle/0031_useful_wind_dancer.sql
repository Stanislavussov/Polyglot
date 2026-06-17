CREATE TABLE "language_detection_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" text NOT NULL,
	"word" text NOT NULL,
	"source_lang" text,
	"target_langs" text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "language_detection_events" ADD CONSTRAINT "language_detection_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lde_user_id_idx" ON "language_detection_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lde_created_at_idx" ON "language_detection_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lde_event_type_idx" ON "language_detection_events" USING btree ("event_type");