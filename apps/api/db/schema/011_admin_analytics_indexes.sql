-- Aggregate access paths: analytics filters by the pinned logical Question and
-- exact revision before joining the owning Conversation or Session for Pair ID.
CREATE INDEX private_candidate_analytics_question_revision_idx
    ON private_question_candidate (question_id, question_revision_id, conversation_id);

CREATE INDEX together_question_analytics_question_revision_idx
    ON together_session_question (question_id, question_revision_id, session_id);
