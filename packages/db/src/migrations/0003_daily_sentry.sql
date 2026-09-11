CREATE TABLE "together_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"category" "question_category" NOT NULL,
	"started_by_participant_id" uuid NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"start_request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "together_session_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"shown_at" timestamp DEFAULT now() NOT NULL,
	"liked_at" timestamp,
	"skipped_at" timestamp,
	"advanced_at" timestamp,
	"advance_request_id" uuid,
	CONSTRAINT "together_session_question_position_positive" CHECK ("together_session_question"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_pair_id_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session" ADD CONSTRAINT "together_session_started_by_participant_id_participant_id_fk" FOREIGN KEY ("started_by_participant_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_session_id_together_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "together_session_question" ADD CONSTRAINT "together_session_question_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_start_request_uidx" ON "together_session" USING btree ("pair_id","started_by_participant_id","start_request_id") WHERE "together_session"."start_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_pair_id_id_uidx" ON "together_session" USING btree ("pair_id","id");--> statement-breakpoint
CREATE INDEX "together_session_pair_started_idx" ON "together_session" USING btree ("pair_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_once_uidx" ON "together_session_question" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_position_uidx" ON "together_session_question" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "together_session_question_advance_request_uidx" ON "together_session_question" USING btree ("session_id","advance_request_id") WHERE "together_session_question"."advance_request_id" is not null;--> statement-breakpoint
CREATE INDEX "together_session_question_current_idx" ON "together_session_question" USING btree ("session_id","advanced_at");
--> statement-breakpoint
INSERT INTO "question" ("id", "text", "category", "relationship_fit", "mode_fit", "depth") VALUES
  ('00000000-0000-4000-8000-000000000104', 'What is a small joy you would love more of in an ordinary week?', 'fun', 'both', 'together', 'light'),
  ('00000000-0000-4000-8000-000000000105', 'If our day together had a soundtrack, what song would be on it?', 'fun', 'both', 'together', 'light'),
  ('00000000-0000-4000-8000-000000000205', 'What part of who you are feels most different from a few years ago?', 'deep', 'both', 'together', 'deep'),
  ('00000000-0000-4000-8000-000000000206', 'What is something you are learning to be kinder to yourself about?', 'deep', 'both', 'together', 'deep'),
  ('00000000-0000-4000-8000-000000000207', 'What belief or value has quietly become more important to you lately?', 'deep', 'both', 'together', 'medium'),
  ('00000000-0000-4000-8000-000000000304', 'What is a moment with us you would happily press replay on?', 'memories', 'both', 'together', 'light'),
  ('00000000-0000-4000-8000-000000000305', 'What did we do together that turned out better than you expected?', 'memories', 'both', 'together', 'medium'),
  ('00000000-0000-4000-8000-000000000404', 'What helps you feel like we are on the same team?', 'relationship', 'partner', 'together', 'medium'),
  ('00000000-0000-4000-8000-000000000405', 'What is one way our relationship has surprised you?', 'relationship', 'partner', 'together', 'medium'),
  ('00000000-0000-4000-8000-000000000406', 'What kind of future moment would you love us to create together?', 'relationship', 'partner', 'together', 'deep'),
  ('00000000-0000-4000-8000-000000000504', 'What is a shared story about us that you never get tired of telling?', 'friendship', 'friend', 'together', 'light'),
  ('00000000-0000-4000-8000-000000000505', 'What is something you think we bring out in each other?', 'friendship', 'friend', 'together', 'medium'),
  ('00000000-0000-4000-8000-000000000506', 'What would make the next chapter of our friendship feel exciting?', 'friendship', 'friend', 'together', 'deep')
ON CONFLICT ("id") DO NOTHING;
