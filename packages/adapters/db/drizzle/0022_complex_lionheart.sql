CREATE TABLE "bot_sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_sessions_updated_at_idx" ON "bot_sessions" USING btree ("updated_at");