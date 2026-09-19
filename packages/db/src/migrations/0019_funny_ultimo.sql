ALTER TABLE "private_question_candidate" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ALTER COLUMN "state" SET DEFAULT 'unresolved'::text;--> statement-breakpoint
DROP TYPE "public"."private_question_candidate_state";--> statement-breakpoint
CREATE TYPE "public"."private_question_candidate_state" AS ENUM('unresolved', 'asked', 'invalidated');--> statement-breakpoint
ALTER TABLE "private_question_candidate" ALTER COLUMN "state" SET DEFAULT 'unresolved'::"public"."private_question_candidate_state";--> statement-breakpoint
ALTER TABLE "private_question_candidate" ALTER COLUMN "state" SET DATA TYPE "public"."private_question_candidate_state" USING "state"::"public"."private_question_candidate_state";--> statement-breakpoint
ALTER TABLE "private_question_candidate" DROP COLUMN "liked";