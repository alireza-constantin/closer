ALTER TABLE "private_question_candidate" ADD COLUMN "liked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "question_number" integer;--> statement-breakpoint
WITH numbered_rounds AS (
	SELECT "id", row_number() OVER (PARTITION BY "conversation_id" ORDER BY "created_at", "id") AS "question_number"
	FROM "private_round"
)
UPDATE "private_round"
SET "question_number" = numbered_rounds."question_number"
FROM numbered_rounds
WHERE "private_round"."id" = numbered_rounds."id";--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "question_number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "private_round_conversation_number_uidx" ON "private_round" USING btree ("conversation_id","question_number");--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_number_positive" CHECK ("private_round"."question_number" > 0);
