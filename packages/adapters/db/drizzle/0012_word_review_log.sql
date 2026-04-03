CREATE TABLE IF NOT EXISTS "word_review_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_id" integer NOT NULL REFERENCES "vocabulary_entries"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "session_type" text NOT NULL,
  "reviewed_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "word_review_log_entry_idx" ON "word_review_log" ("entry_id");
CREATE INDEX "word_review_log_user_date_idx" ON "word_review_log" ("user_id", "reviewed_at");
