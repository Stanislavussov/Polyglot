CREATE TABLE "ai_model_plan_access" (
	"model_id" varchar(255) NOT NULL,
	"plan_name" varchar(50) NOT NULL,
	CONSTRAINT "ai_model_plan_access_model_id_plan_name_pk" PRIMARY KEY("model_id","plan_name")
);
--> statement-breakpoint
ALTER TABLE "rate_limit_plans" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_plan_access" ADD CONSTRAINT "ai_model_plan_access_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_plan_access" ADD CONSTRAINT "ai_model_plan_access_plan_name_rate_limit_plans_name_fk" FOREIGN KEY ("plan_name") REFERENCES "public"."rate_limit_plans"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_plan_access_plan_idx" ON "ai_model_plan_access" USING btree ("plan_name");