CREATE TABLE "momentum_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_momentum" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_praise_at" timestamp with time zone,
	"last_recovery_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "momentum_events" ADD CONSTRAINT "momentum_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_momentum" ADD CONSTRAINT "user_momentum_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "momentum_events_user_dedupe_idx" ON "momentum_events" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "momentum_events_user_time_idx" ON "momentum_events" USING btree ("user_id","occurred_at");