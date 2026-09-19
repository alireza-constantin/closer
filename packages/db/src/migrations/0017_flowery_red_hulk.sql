ALTER TYPE "public"."private_round_status" ADD VALUE 'retired';--> statement-breakpoint
ALTER TABLE "private_round" DROP CONSTRAINT "private_round_decline_audit_consistent";--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "committed_at" timestamp;--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "provisional_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "retired_by_participant_id" uuid;--> statement-breakpoint
ALTER TABLE "private_round" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_retired_by_participant_id_participant_id_fk" FOREIGN KEY ("retired_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
UPDATE "private_round" SET "committed_at" = "created_at" WHERE "committed_at" IS NULL;
--> statement-breakpoint
UPDATE "private_round" SET "status" = 'retired', "retired_by_participant_id" = "declined_by_participant_id", "retired_at" = "declined_at" WHERE "status" = 'declined';
--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_retirement_audit_consistent" CHECK (("private_round"."status" = 'open' and "private_round"."retired_by_participant_id" is null and "private_round"."retired_at" is null) or ("private_round"."status" in ('declined', 'retired') and "private_round"."retired_by_participant_id" is not null and "private_round"."retired_at" is not null));
