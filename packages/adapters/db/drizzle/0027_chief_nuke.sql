CREATE TABLE "translation_request_timings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"request_type" text NOT NULL,
	"preflight_ms" integer NOT NULL,
	"db_lookup_ms" integer NOT NULL,
	"ai_request_ms" integer NOT NULL,
	"total_ms" integer NOT NULL,
	"model_id" varchar(255),
	"source_lang" text,
	"target_langs" text[],
	"input_type" text,
	"success" boolean NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "translation_request_timings" ADD CONSTRAINT "translation_request_timings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trt_user_id_idx" ON "translation_request_timings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trt_created_at_idx" ON "translation_request_timings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trt_request_type_idx" ON "translation_request_timings" USING btree ("request_type");