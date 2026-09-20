CREATE TYPE "public"."question_lifecycle_action" AS ENUM('activated', 'reactivated', 'deactivated', 'revision_withdrawn');--> statement-breakpoint
CREATE TABLE "question_lifecycle_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"revision_id" uuid,
	"action" "question_lifecycle_action" NOT NULL,
	"admin_user_id" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "question_lifecycle_withdrawal_reason_required" CHECK ("question_lifecycle_event"."action" <> 'revision_withdrawn' or ("question_lifecycle_event"."revision_id" is not null and "question_lifecycle_event"."reason" is not null and char_length(btrim("question_lifecycle_event"."reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "revision_number" integer;--> statement-breakpoint
WITH "ordered_revisions" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "question_id"
			ORDER BY "created_at" ASC, "id" ASC
		)::integer AS "revision_number"
	FROM "question_revision"
)
UPDATE "question_revision" AS "revision"
SET "revision_number" = "ordered_revisions"."revision_number"
FROM "ordered_revisions"
WHERE "revision"."id" = "ordered_revisions"."id";--> statement-breakpoint
ALTER TABLE "question_revision" ALTER COLUMN "revision_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "created_by_admin_user_id" text;--> statement-breakpoint
ALTER TABLE "question_lifecycle_event" ADD CONSTRAINT "question_lifecycle_event_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_lifecycle_event" ADD CONSTRAINT "question_lifecycle_event_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_lifecycle_event" ADD CONSTRAINT "question_lifecycle_event_revision_question_fk" FOREIGN KEY ("question_id","revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_lifecycle_event_occurred_idx" ON "question_lifecycle_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "question_lifecycle_event_question_occurred_idx" ON "question_lifecycle_event" USING btree ("question_id","occurred_at");--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_current_revision_question_fk" FOREIGN KEY ("id","current_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_created_by_admin_user_id_user_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_question_number_key" UNIQUE("question_id","revision_number");
