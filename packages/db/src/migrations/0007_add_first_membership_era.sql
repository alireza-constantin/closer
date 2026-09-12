CREATE TABLE "pair_membership_era" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
INSERT INTO "pair_membership_era" ("pair_id")
SELECT "pair"."id"
FROM "pair"
WHERE EXISTS (
  SELECT 1 FROM "pair_membership" AS "first_member"
  WHERE "first_member"."pair_id" = "pair"."id"
    AND "first_member"."slot" = 'first'
    AND "first_member"."ended_at" IS NULL
)
AND EXISTS (
  SELECT 1 FROM "pair_membership" AS "second_member"
  WHERE "second_member"."pair_id" = "pair"."id"
    AND "second_member"."slot" = 'second'
    AND "second_member"."ended_at" IS NULL
);
--> statement-breakpoint
ALTER TABLE "together_session" ADD COLUMN "membership_era_id" uuid;--> statement-breakpoint
UPDATE "together_session"
SET "membership_era_id" = "pair_membership_era"."id"
FROM "pair_membership_era"
WHERE "together_session"."pair_id" = "pair_membership_era"."pair_id"
  AND "pair_membership_era"."ended_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_membership_era_one_active_uidx" ON "pair_membership_era" USING btree ("pair_id") WHERE "pair_membership_era"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "pair_membership_era_pair_started_idx" ON "pair_membership_era" USING btree ("pair_id","started_at");--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_membership_era_id_pair_membership_era_id_fk" FOREIGN KEY ("membership_era_id") REFERENCES "public"."pair_membership_era"("id") ON DELETE restrict ON UPDATE no action;
