CREATE TABLE IF NOT EXISTS "user_translation_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL DEFAULT 'Custom',
  "transcription" boolean NOT NULL DEFAULT true,
  "synonyms" boolean NOT NULL DEFAULT true,
  "examples" boolean NOT NULL DEFAULT true,
  "alternatives" boolean NOT NULL DEFAULT true,
  "equivalent_note" boolean NOT NULL DEFAULT true,
  "connotation_warning" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_translation_templates_user_id_idx"
  ON "user_translation_templates" ("user_id");
