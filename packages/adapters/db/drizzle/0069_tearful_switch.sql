CREATE TABLE "progress_months" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"tz" text NOT NULL,
	"active_days" integer NOT NULL,
	"mature_gained" integer NOT NULL,
	"saved_gained" integer NOT NULL,
	"counted" boolean NOT NULL,
	"plan_days" jsonb NOT NULL,
	"source" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress_months" ADD CONSTRAINT "progress_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progress_months_user_month_idx" ON "progress_months" USING btree ("user_id","month");