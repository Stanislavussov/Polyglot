CREATE TABLE "notification_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "original" text NOT NULL,
  "source" text NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "notif_hist_user_sent_idx" ON "notification_history" ("user_id", "sent_at");
