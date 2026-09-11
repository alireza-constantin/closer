CREATE TABLE "private_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"category" "question_category" NOT NULL,
	"created_by_participant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_created_by_participant_id_participant_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Slice 01B originally allowed unrelated rounds. Development rows are grouped
-- deterministically by pair and question category so their existing answers,
-- reactions, and replies remain attached to a single conversation.
INSERT INTO "private_conversation" ("pair_id", "category", "created_by_participant_id", "created_at")
SELECT DISTINCT ON (r."pair_id", q."category")
  r."pair_id", q."category", r."initiator_participant_id", r."created_at"
FROM "private_round" r
INNER JOIN "question" q ON q."id" = r."question_id"
ORDER BY r."pair_id", q."category", r."created_at", r."id";--> statement-breakpoint
UPDATE "private_round" r
SET "conversation_id" = c."id"
FROM "question" q, "private_conversation" c
WHERE q."id" = r."question_id"
  AND c."pair_id" = r."pair_id"
  AND c."category" = q."category";--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "private_conversation_one_active_category_uidx" ON "private_conversation" USING btree ("pair_id","category") WHERE "private_conversation"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "private_conversation_pair_id_id_uidx" ON "private_conversation" USING btree ("pair_id","id");--> statement-breakpoint
CREATE INDEX "private_conversation_pair_created_idx" ON "private_conversation" USING btree ("pair_id","created_at");--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_pair_conversation_consistent_fk" FOREIGN KEY ("pair_id","conversation_id") REFERENCES "public"."private_conversation"("pair_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_round_conversation_created_idx" ON "private_round" USING btree ("conversation_id","created_at");
