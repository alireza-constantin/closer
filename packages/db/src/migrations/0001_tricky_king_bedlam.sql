CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
ALTER TYPE "public"."private_question_candidate_state" ADD VALUE 'skipped' BEFORE 'invalidated';--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD COLUMN "liked_at" timestamp;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD COLUMN "skip_request_id" uuid;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD COLUMN "skip_result_candidate_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "private_candidate_skip_request_uidx" ON "private_question_candidate" USING btree ("conversation_id","skip_request_id") WHERE "private_question_candidate"."skip_request_id" is not null;
