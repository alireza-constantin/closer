CREATE TABLE "rejoin_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"target_slot" "pair_slot" NOT NULL,
	"target_participant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"redeemed_at" timestamp,
	"redeemed_by_participant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_target_participant_id_participant_id_fk" FOREIGN KEY ("target_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_redeemed_by_participant_id_participant_id_fk" FOREIGN KEY ("redeemed_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rejoin_invite_token_hash_uidx" ON "rejoin_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "rejoin_invite_pair_idx" ON "rejoin_invite" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "rejoin_invite_target_idx" ON "rejoin_invite" USING btree ("pair_id","target_slot","target_participant_id");