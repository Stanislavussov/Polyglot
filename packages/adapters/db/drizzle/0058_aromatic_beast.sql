CREATE TABLE "product_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event" varchar(64) NOT NULL,
	"context" varchar(64),
	"plan" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_events_event_created_idx" ON "product_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "product_events_created_at_idx" ON "product_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_events_user_id_idx" ON "product_events" USING btree ("user_id");