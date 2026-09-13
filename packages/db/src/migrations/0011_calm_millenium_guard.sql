CREATE TYPE "public"."private_question_candidate_state" AS ENUM('unresolved', 'asked', 'skipped', 'invalidated');--> statement-breakpoint
CREATE TABLE "private_question_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"state" "private_question_candidate_state" DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "private_conversation" ADD COLUMN "selection_seed" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_conversation_id_private_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."private_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_candidate_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "private_candidate_one_unresolved_uidx" ON "private_question_candidate" USING btree ("conversation_id") WHERE "private_question_candidate"."state" = 'unresolved';--> statement-breakpoint
CREATE INDEX "private_candidate_conversation_created_idx" ON "private_question_candidate" USING btree ("conversation_id","created_at");