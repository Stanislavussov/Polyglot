CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"text" text NOT NULL,
	"parse_mode" varchar(16),
	"meta" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notif_deliveries_user_sent_idx" ON "notification_deliveries" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "notif_deliveries_sent_idx" ON "notification_deliveries" USING btree ("sent_at");