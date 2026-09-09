ALTER TABLE "ai_model_plan_access" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_model_plan_access" CASCADE;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "is_fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD COLUMN "ai_model_id" varchar(255);--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD CONSTRAINT "rate_limit_plans_ai_model_id_ai_models_id_fk" FOREIGN KEY ("ai_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;