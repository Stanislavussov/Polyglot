CREATE TABLE "ai_request_latencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"request_kind" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"success" boolean NOT NULL,
	"user_id" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_request_latencies" ADD CONSTRAINT "ai_request_latencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_req_latency_model_date_idx" ON "ai_request_latencies" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_req_latency_created_at_idx" ON "ai_request_latencies" USING btree ("created_at");