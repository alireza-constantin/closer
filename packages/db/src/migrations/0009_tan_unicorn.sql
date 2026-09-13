ALTER TYPE "public"."question_depth" RENAME TO "question_intensity";--> statement-breakpoint
CREATE TABLE "question_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"category" "question_category" NOT NULL,
	"relationship_fit" "question_relationship_fit" NOT NULL,
	"mode_fit" "question_mode_fit" NOT NULL,
	"intensity" "question_intensity" NOT NULL,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "question_revision_question_id_id_key" UNIQUE("question_id","id"),
	CONSTRAINT "question_revision_text_not_blank" CHECK (char_length(btrim("question_revision"."text")) > 0),
	CONSTRAINT "question_revision_category_relationship_fit_valid" CHECK (("question_revision"."category" not in ('relationship', 'friendship')) or ("question_revision"."category" = 'relationship' and "question_revision"."relationship_fit" = 'partner') or ("question_revision"."category" = 'friendship' and "question_revision"."relationship_fit" = 'friend'))
);
--> statement-breakpoint
ALTER TABLE "question" DROP CONSTRAINT "question_text_not_blank";--> statement-breakpoint
ALTER TABLE "question" DROP CONSTRAINT "question_category_relationship_fit_valid";--> statement-breakpoint
DROP INDEX "question_private_selection_idx";--> statement-breakpoint
ALTER TABLE "private_round" DROP CONSTRAINT IF EXISTS "private_round_pair_conversation_consistent_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "private_conversation_pair_id_id_uidx";--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "question_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD COLUMN "question_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "question_revision" ("question_id", "text", "category", "relationship_fit", "mode_fit", "intensity", "created_at")
SELECT "id", "text", "category", "relationship_fit", "mode_fit", "depth", "created_at"
FROM "question";--> statement-breakpoint
UPDATE "question" AS q
SET "current_revision_id" = r."id"
FROM "question_revision" AS r
WHERE r."question_id" = q."id";--> statement-breakpoint
UPDATE "private_round" AS occurrence
SET "question_revision_id" = revision."id"
FROM "question_revision" AS revision
WHERE revision."question_id" = occurrence."question_id";--> statement-breakpoint
UPDATE "together_session_question" AS occurrence
SET "question_revision_id" = revision."id"
FROM "question_revision" AS revision
WHERE revision."question_id" = occurrence."question_id";--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "question_revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "together_session_question" ALTER COLUMN "question_revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_current_revision_id_question_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_selection_idx" ON "question" USING btree ("is_active","current_revision_id");--> statement-breakpoint
CREATE INDEX "question_revision_selection_idx" ON "question_revision" USING btree ("category","mode_fit","relationship_fit","intensity");--> statement-breakpoint
CREATE INDEX "question_revision_question_created_idx" ON "question_revision" USING btree ("question_id","created_at");--> statement-breakpoint
ALTER TABLE "question" DROP COLUMN "text";--> statement-breakpoint
ALTER TABLE "question" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "question" DROP COLUMN "relationship_fit";--> statement-breakpoint
ALTER TABLE "question" DROP COLUMN "mode_fit";--> statement-breakpoint
ALTER TABLE "question" DROP COLUMN "depth";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'private_conversation_pair_id_id_key'
      AND conrelid = 'private_conversation'::regclass
  ) THEN
    ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_pair_id_id_key" UNIQUE("pair_id","id");
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_pair_conversation_consistent_fk" FOREIGN KEY ("pair_id","conversation_id") REFERENCES "public"."private_conversation"("pair_id","id") ON DELETE cascade ON UPDATE no action;
