ALTER TABLE "private_round" DROP CONSTRAINT "private_round_declined_by_participant_id_participant_id_fk";
--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."private_round_status";--> statement-breakpoint
CREATE TYPE "public"."private_round_status" AS ENUM('open', 'retired');--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."private_round_status";--> statement-breakpoint
ALTER TABLE "private_round" ALTER COLUMN "status" SET DATA TYPE "public"."private_round_status" USING "status"::"public"."private_round_status";--> statement-breakpoint
ALTER TABLE "private_round" DROP COLUMN "declined_by_participant_id";--> statement-breakpoint
ALTER TABLE "private_round" DROP COLUMN "declined_at";