CREATE TABLE "notification_interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "telegram_message_id" integer;--> statement-breakpoint
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notif_interactions_delivery_created_idx" ON "notification_interactions" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_deliveries_user_message_idx" ON "notification_deliveries" USING btree ("user_id","telegram_message_id");