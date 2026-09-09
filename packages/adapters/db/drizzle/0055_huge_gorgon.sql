CREATE TABLE "mentor_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"chat_id" bigint NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"telegram_message_id" bigint NOT NULL,
	"interface_lang" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentor_messages" ADD CONSTRAINT "mentor_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentor_msg_chat_tgid_idx" ON "mentor_messages" USING btree ("chat_id","telegram_message_id");--> statement-breakpoint
CREATE INDEX "mentor_msg_thread_idx" ON "mentor_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX "mentor_msg_user_created_idx" ON "mentor_messages" USING btree ("user_id","created_at");