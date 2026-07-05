CREATE TYPE "public"."video_window" AS ENUM('none', 'lifetime', 'monthly');--> statement-breakpoint
CREATE TABLE "plan_feature_access" (
	"plan_name" varchar(50) NOT NULL,
	"feature_key" varchar(100) NOT NULL,
	CONSTRAINT "plan_feature_access_plan_name_feature_key_pk" PRIMARY KEY("plan_name","feature_key")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan" varchar(50) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" varchar(50) DEFAULT 'mock' NOT NULL,
	"external_id" text,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD COLUMN "translation_limit" integer;--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD COLUMN "video_limit" integer;--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD COLUMN "video_window" "video_window" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_feature_access" ADD CONSTRAINT "plan_feature_access_plan_name_rate_limit_plans_name_fk" FOREIGN KEY ("plan_name") REFERENCES "public"."rate_limit_plans"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_rate_limit_plans_name_fk" FOREIGN KEY ("plan") REFERENCES "public"."rate_limit_plans"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_feature_access_feature_idx" ON "plan_feature_access" USING btree ("feature_key");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
ALTER TABLE "rate_limit_plans" DROP COLUMN "credits_per_day";--> statement-breakpoint
ALTER TABLE "rate_limit_plans" DROP COLUMN "window_ms";