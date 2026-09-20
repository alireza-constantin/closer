CREATE TYPE "public"."pair_relationship_type" AS ENUM('partner', 'friend');--> statement-breakpoint
CREATE TYPE "public"."pair_slot" AS ENUM('first', 'second');--> statement-breakpoint
CREATE TYPE "public"."private_question_candidate_state" AS ENUM('unresolved', 'asked', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."private_reaction_value" AS ENUM('heart', 'laugh', 'tender', 'surprised');--> statement-breakpoint
CREATE TYPE "public"."private_round_status" AS ENUM('open', 'retired');--> statement-breakpoint
CREATE TYPE "public"."question_category" AS ENUM('fun', 'deep', 'memories', 'relationship', 'friendship');--> statement-breakpoint
CREATE TYPE "public"."question_intensity" AS ENUM('light', 'medium', 'deep');--> statement-breakpoint
CREATE TYPE "public"."question_mode_fit" AS ENUM('both', 'together', 'private');--> statement-breakpoint
CREATE TYPE "public"."question_relationship_fit" AS ENUM('both', 'partner', 'friend');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initial_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"slot" "pair_slot" DEFAULT 'second' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"redeemed_at" timestamp,
	"redeemed_by_participant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "initial_invite_second_slot_only" CHECK ("initial_invite"."slot" = 'second')
);
--> statement-breakpoint
CREATE TABLE "pair" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relationship_type" "pair_relationship_type" NOT NULL,
	"intended_person_name" text,
	"creation_request_id" uuid,
	"terminated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pair_intended_person_name_valid" CHECK ("pair"."intended_person_name" is null or (char_length("pair"."intended_person_name") between 1 and 40 and "pair"."intended_person_name" = btrim("pair"."intended_person_name")))
);
--> statement-breakpoint
CREATE TABLE "pair_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"slot" "pair_slot" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"ended_display_name" text
);
--> statement-breakpoint
CREATE TABLE "pair_membership_era" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"first_membership_id" uuid NOT NULL,
	"second_membership_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "participant_display_name_valid" CHECK (char_length("participant"."display_name") between 1 and 40 and "participant"."display_name" = btrim("participant"."display_name"))
);
--> statement-breakpoint
CREATE TABLE "private_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "private_answer_body_valid" CHECK (char_length("private_answer"."body") between 1 and 2000 and "private_answer"."body" = btrim("private_answer"."body"))
);
--> statement-breakpoint
CREATE TABLE "private_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"category" "question_category" NOT NULL,
	"created_by_participant_id" uuid NOT NULL,
	"membership_era_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"selection_seed" text DEFAULT gen_random_uuid()::text NOT NULL,
	CONSTRAINT "private_conversation_pair_id_id_key" UNIQUE("pair_id","id")
);
--> statement-breakpoint
CREATE TABLE "private_question_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"state" "private_question_candidate_state" DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
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
	"conversation_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"question_number" integer NOT NULL,
	"initiator_participant_id" uuid NOT NULL,
	"client_request_id" uuid,
	"status" "private_round_status" DEFAULT 'open' NOT NULL,
	"committed_at" timestamp,
	"provisional_expires_at" timestamp,
	"retired_by_participant_id" uuid,
	"retired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "private_round_question_number_positive" CHECK ("private_round"."question_number" > 0),
	CONSTRAINT "private_round_retirement_audit_consistent" CHECK (("private_round"."status" = 'open' and "private_round"."retired_by_participant_id" is null and "private_round"."retired_at" is null) or ("private_round"."status" = 'retired' and "private_round"."retired_by_participant_id" is not null and "private_round"."retired_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_revision_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "together_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"membership_era_id" uuid,
	"category" "question_category" NOT NULL,
	"started_by_participant_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"start_request_id" uuid,
	"selection_seed" text DEFAULT gen_random_uuid()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "together_session_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"shown_at" timestamp DEFAULT now() NOT NULL,
	"liked_at" timestamp,
	"skipped_at" timestamp,
	"advanced_at" timestamp,
	"advance_request_id" uuid,
	CONSTRAINT "together_session_question_position_positive" CHECK ("together_session_question"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initial_invite" ADD CONSTRAINT "initial_invite_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initial_invite" ADD CONSTRAINT "initial_invite_redeemed_by_participant_id_participant_id_fk" FOREIGN KEY ("redeemed_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership" ADD CONSTRAINT "pair_membership_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership" ADD CONSTRAINT "pair_membership_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_first_membership_id_pair_membership_id_fk" FOREIGN KEY ("first_membership_id") REFERENCES "public"."pair_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_membership_era" ADD CONSTRAINT "pair_membership_era_second_membership_id_pair_membership_id_fk" FOREIGN KEY ("second_membership_id") REFERENCES "public"."pair_membership"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_answer" ADD CONSTRAINT "private_answer_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_answer" ADD CONSTRAINT "private_answer_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_created_by_participant_id_participant_id_fk" FOREIGN KEY ("created_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_conversation" ADD CONSTRAINT "private_conversation_membership_era_id_pair_membership_era_id_fk" FOREIGN KEY ("membership_era_id") REFERENCES "public"."pair_membership_era"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_conversation_id_private_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."private_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_question_candidate_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_question_candidate" ADD CONSTRAINT "private_candidate_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reaction" ADD CONSTRAINT "private_reaction_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reaction" ADD CONSTRAINT "private_reaction_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply" ADD CONSTRAINT "private_reply_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reply" ADD CONSTRAINT "private_reply_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reveal_view" ADD CONSTRAINT "private_reveal_view_round_id_private_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."private_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_reveal_view" ADD CONSTRAINT "private_reveal_view_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_initiator_participant_id_participant_id_fk" FOREIGN KEY ("initiator_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_retired_by_participant_id_participant_id_fk" FOREIGN KEY ("retired_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_round" ADD CONSTRAINT "private_round_pair_conversation_consistent_fk" FOREIGN KEY ("pair_id","conversation_id") REFERENCES "public"."private_conversation"("pair_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_current_revision_id_question_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_target_participant_id_participant_id_fk" FOREIGN KEY ("target_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejoin_invite" ADD CONSTRAINT "rejoin_invite_redeemed_by_participant_id_participant_id_fk" FOREIGN KEY ("redeemed_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_membership_era_id_pair_membership_era_id_fk" FOREIGN KEY ("membership_era_id") REFERENCES "public"."pair_membership_era"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_started_by_participant_id_participant_id_fk" FOREIGN KEY ("started_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_session_id_together_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_revision_belongs_to_question_fk" FOREIGN KEY ("question_id","question_revision_id") REFERENCES "public"."question_revision"("question_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "initial_invite_token_hash_uidx" ON "initial_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "initial_invite_pair_idx" ON "initial_invite" USING btree ("pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pair_creation_request_uidx" ON "pair" USING btree ("creation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pair_membership_one_active_slot_uidx" ON "pair_membership" USING btree ("pair_id","slot") WHERE "pair_membership"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_membership_one_active_participant_uidx" ON "pair_membership" USING btree ("pair_id","participant_id") WHERE "pair_membership"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "pair_membership_active_participant_idx" ON "pair_membership" USING btree ("participant_id","pair_id") WHERE "pair_membership"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_membership_era_one_active_uidx" ON "pair_membership_era" USING btree ("pair_id") WHERE "pair_membership_era"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "pair_membership_era_pair_started_idx" ON "pair_membership_era" USING btree ("pair_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_auth_user_id_uidx" ON "participant" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_answer_round_participant_uidx" ON "private_answer" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_conversation_one_era_category_uidx" ON "private_conversation" USING btree ("pair_id","membership_era_id","category");--> statement-breakpoint
CREATE INDEX "private_conversation_pair_created_idx" ON "private_conversation" USING btree ("pair_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_candidate_one_unresolved_uidx" ON "private_question_candidate" USING btree ("conversation_id") WHERE "private_question_candidate"."state" = 'unresolved';--> statement-breakpoint
CREATE INDEX "private_candidate_conversation_created_idx" ON "private_question_candidate" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reaction_round_participant_uidx" ON "private_reaction" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reply_round_participant_uidx" ON "private_reply" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_reveal_view_round_participant_uidx" ON "private_reveal_view" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE INDEX "private_round_pair_created_idx" ON "private_round" USING btree ("pair_id","created_at");--> statement-breakpoint
CREATE INDEX "private_round_conversation_created_idx" ON "private_round" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "private_round_conversation_number_uidx" ON "private_round" USING btree ("conversation_id","question_number");--> statement-breakpoint
CREATE UNIQUE INDEX "private_round_idempotency_uidx" ON "private_round" USING btree ("pair_id","initiator_participant_id","client_request_id") WHERE "private_round"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "question_selection_idx" ON "question" USING btree ("is_active","current_revision_id");--> statement-breakpoint
CREATE INDEX "question_revision_selection_idx" ON "question_revision" USING btree ("category","mode_fit","relationship_fit","intensity");--> statement-breakpoint
CREATE INDEX "question_revision_question_created_idx" ON "question_revision" USING btree ("question_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rejoin_invite_token_hash_uidx" ON "rejoin_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "rejoin_invite_pair_idx" ON "rejoin_invite" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "rejoin_invite_target_idx" ON "rejoin_invite" USING btree ("pair_id","target_slot","target_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_start_request_uidx" ON "together_session" USING btree ("pair_id","started_by_participant_id","start_request_id") WHERE "together_session"."start_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_pair_id_id_uidx" ON "together_session" USING btree ("pair_id","id");--> statement-breakpoint
CREATE INDEX "together_session_pair_started_idx" ON "together_session" USING btree ("pair_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_once_uidx" ON "together_session_question" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_position_uidx" ON "together_session_question" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_advance_request_uidx" ON "together_session_question" USING btree ("session_id","advance_request_id") WHERE "together_session_question"."advance_request_id" is not null;--> statement-breakpoint
CREATE INDEX "together_session_question_current_idx" ON "together_session_question" USING btree ("session_id","advanced_at");