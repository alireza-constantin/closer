CREATE TYPE "public"."private_reaction_value" AS ENUM('heart', 'laugh', 'tender', 'surprised');--> statement-breakpoint
CREATE TYPE "public"."question_category" AS ENUM('fun', 'deep', 'memories', 'relationship', 'friendship');--> statement-breakpoint
CREATE TYPE "public"."question_depth" AS ENUM('light', 'medium', 'deep');--> statement-breakpoint
CREATE TYPE "public"."question_mode_fit" AS ENUM('both', 'together', 'private');--> statement-breakpoint
CREATE TYPE "public"."question_relationship_fit" AS ENUM('both', 'partner', 'friend');--> statement-breakpoint
CREATE TABLE "private_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "private_answer_body_valid" CHECK (char_length("private_answer"."body") between 1 and 2000 and "private_answer"."body" = btrim("private_answer"."body"))
);
--> statement-breakpoint
CREATE TABLE "private_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"value" "private_reaction_value" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "private_reply_body_valid" CHECK (char_length("private_reply"."body") between 1 and 500 and "private_reply"."body" = btrim("private_reply"."body"))
);
--> statement-breakpoint
CREATE TABLE "private_reveal_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"initiator_participant_id" uuid NOT NULL,
	"client_request_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"category" "question_category" NOT NULL,
	"relationship_fit" "question_relationship_fit" NOT NULL,
	"mode_fit" "question_mode_fit" NOT NULL,
	"depth" "question_depth" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "question_text_not_blank" CHECK (char_length(btrim("question"."text")) > 0),
	CONSTRAINT "question_category_relationship_fit_valid" CHECK (("question"."category" not in ('relationship', 'friendship')) or ("question"."category" = 'relationship' and "question"."relationship_fit" = 'partner') or ("question"."category" = 'friendship' and "question"."relationship_fit" = 'friend'))
);
--> statement-breakpoint
ALTER TABLE "private_answer" ADD CONSTRAINT "private_answer_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_answer" ADD CONSTRAINT "private_answer_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reaction" ADD CONSTRAINT "private_reaction_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reaction" ADD CONSTRAINT "private_reaction_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply" ADD CONSTRAINT "private_reply_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply" ADD CONSTRAINT "private_reply_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reveal_view" ADD CONSTRAINT "private_reveal_view_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reveal_view" ADD CONSTRAINT "private_reveal_view_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_initiator_participant_id_participant_id_fk" FOREIGN KEY ("initiator_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "private_answer_round_participant_uidx" ON "private_answer" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reaction_round_participant_uidx" ON "private_reaction" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reply_round_participant_uidx" ON "private_reply" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reveal_view_round_participant_uidx" ON "private_reveal_view" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE INDEX "private_round_pair_created_idx" ON "private_round" USING btree ("pair_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_round_idempotency_uidx" ON "private_round" USING btree ("pair_id","initiator_participant_id","client_request_id") WHERE "private_round"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "question_private_selection_idx" ON "question" USING btree ("is_active","category","mode_fit","relationship_fit");
--> statement-breakpoint
INSERT INTO "question" ("id", "text", "category", "relationship_fit", "mode_fit", "depth") VALUES
  ('00000000-0000-4000-8000-000000000101', 'What tiny thing always makes you laugh?', 'fun', 'both', 'both', 'light'),
  ('00000000-0000-4000-8000-000000000102', 'If we had a completely free Saturday, how would you spend it?', 'fun', 'both', 'private', 'light'),
  ('00000000-0000-4000-8000-000000000103', 'What harmless opinion would you defend far too passionately?', 'fun', 'both', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000201', 'What is something you wish we did more often together?', 'deep', 'both', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000202', 'When do you feel most understood by me?', 'deep', 'both', 'private', 'deep'),
  ('00000000-0000-4000-8000-000000000203', 'What is one hope you have for the next year of your life?', 'deep', 'both', 'private', 'deep'),
  ('00000000-0000-4000-8000-000000000204', 'What is something you think I understand about you?', 'deep', 'both', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000301', 'What memory of us still makes you smile right away?', 'memories', 'both', 'both', 'light'),
  ('00000000-0000-4000-8000-000000000302', 'What ordinary moment with me has stayed with you?', 'memories', 'both', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000303', 'What is a place that will always remind you of us?', 'memories', 'both', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000401', 'What is one ritual you would love for us to make more space for?', 'relationship', 'partner', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000402', 'What helps you feel close to me after a hard day?', 'relationship', 'partner', 'private', 'deep'),
  ('00000000-0000-4000-8000-000000000403', 'What would you love for us to try this year?', 'relationship', 'partner', 'private', 'light'),
  ('00000000-0000-4000-8000-000000000501', 'What do you value most about the way we are friends?', 'friendship', 'friend', 'private', 'medium'),
  ('00000000-0000-4000-8000-000000000502', 'What kind of support from me means the most to you?', 'friendship', 'friend', 'private', 'deep'),
  ('00000000-0000-4000-8000-000000000503', 'What is an adventure you would be excited to have together?', 'friendship', 'friend', 'private', 'light')
ON CONFLICT ("id") DO NOTHING;
