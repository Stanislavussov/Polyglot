CREATE TYPE "public"."audience_group" AS ENUM('admin', 'tester', 'product');--> statement-breakpoint
CREATE TABLE "release_announcement_deliveries" (
	"release_id" text NOT NULL,
	"audience_group" "audience_group" NOT NULL,
	"user_id" integer NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "release_announcement_deliveries_release_id_audience_group_user_id_pk" PRIMARY KEY("release_id","audience_group","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "audience_group" "audience_group" DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "release_announcement_deliveries" ADD CONSTRAINT "release_announcement_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_announcement_deliveries_user_idx" ON "release_announcement_deliveries" USING btree ("user_id");