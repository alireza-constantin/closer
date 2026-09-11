ALTER TABLE "pair" ADD COLUMN "creation_request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_creation_request_uidx" ON "pair" USING btree ("creation_request_id");