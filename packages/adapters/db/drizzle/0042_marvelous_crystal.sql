CREATE INDEX "word_context_lower_word_idx" ON "word_context" USING btree (lower("word"));--> statement-breakpoint
CREATE INDEX "word_context_forms_gin_idx" ON "word_context" USING gin ("forms");