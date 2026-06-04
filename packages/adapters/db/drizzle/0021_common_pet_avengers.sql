ALTER TABLE "translation_requests" ADD COLUMN "credit_cost" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_plan" text DEFAULT 'free' NOT NULL;