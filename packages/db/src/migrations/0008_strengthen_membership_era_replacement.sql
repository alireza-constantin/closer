ALTER TABLE "pair_membership" ADD COLUMN "ended_display_name" text;--> statement-breakpoint
UPDATE "pair_membership"
SET "ended_display_name" = "participant"."display_name"
FROM "participant"
WHERE "pair_membership"."participant_id" = "participant"."id"
  AND "pair_membership"."ended_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD COLUMN "first_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD COLUMN "second_membership_id" uuid;--> statement-breakpoint
INSERT INTO "pair_membership_era" ("pair_id", "first_membership_id", "second_membership_id")
SELECT "first_member"."pair_id", "first_member"."id", "second_member"."id"
FROM "pair_membership" AS "first_member"
INNER JOIN "pair_membership" AS "second_member"
  ON "second_member"."pair_id" = "first_member"."pair_id"
  AND "second_member"."slot" = 'second'
  AND "second_member"."ended_at" IS NULL
LEFT JOIN "pair_membership_era" AS "active_era"
  ON "active_era"."pair_id" = "first_member"."pair_id"
  AND "active_era"."ended_at" IS NULL
WHERE "first_member"."slot" = 'first'
  AND "first_member"."ended_at" IS NULL
  AND "active_era"."id" IS NULL;--> statement-breakpoint
UPDATE "pair_membership_era" AS "era"
SET
  "first_membership_id" = "first_member"."id",
  "second_membership_id" = "second_member"."id"
FROM "pair_membership" AS "first_member"
INNER JOIN "pair_membership" AS "second_member"
  ON "second_member"."pair_id" = "first_member"."pair_id"
  AND "second_member"."slot" = 'second'
  AND "second_member"."ended_at" IS NULL
WHERE "era"."pair_id" = "first_member"."pair_id"
  AND "first_member"."slot" = 'first'
  AND "first_member"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD COLUMN "membership_era_id" uuid;--> statement-breakpoint
UPDATE "private_conversation"
SET "membership_era_id" = "pair_membership_era"."id"
FROM "pair_membership_era"
WHERE "private_conversation"."pair_id" = "pair_membership_era"."pair_id"
  AND "pair_membership_era"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "private_conversation" DROP CONSTRAINT IF EXISTS "private_conversation_membership_era_id_pair_membership_era_id_fk";--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_membership_era_id_pair_membership_era_id_fk" FOREIGN KEY ("membership_era_id") REFERENCES "public"."pair_membership_era"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_first_membership_id_pair_membership_id_fk" FOREIGN KEY ("first_membership_id") REFERENCES "public"."pair_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_second_membership_id_pair_membership_id_fk" FOREIGN KEY ("second_membership_id") REFERENCES "public"."pair_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ALTER COLUMN "first_membership_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ALTER COLUMN "second_membership_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "private_conversation" ALTER COLUMN "membership_era_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "private_conversation_one_active_category_uidx";--> statement-breakpoint
ALTER TABLE "private_conversation" DROP COLUMN "ended_at";--> statement-breakpoint
CREATE UNIQUE INDEX "private_conversation_one_era_category_uidx" ON "private_conversation" USING btree ("pair_id", "membership_era_id", "category");
