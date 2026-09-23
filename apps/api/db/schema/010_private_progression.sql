ALTER TABLE private_round
    ADD COLUMN progression_request_id uuid,
    ADD COLUMN progression_action text,
    ADD COLUMN progression_category text,
    ADD COLUMN progression_conversation_id uuid REFERENCES private_conversation(id) ON DELETE RESTRICT,
    ADD COLUMN progression_candidate_id uuid REFERENCES private_question_candidate(id) ON DELETE RESTRICT,
    ADD COLUMN progression_exhausted boolean NOT NULL DEFAULT false,
    ADD COLUMN progression_waiting boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT private_round_progression_consistent CHECK (
        (progression_request_id IS NULL AND progression_action IS NULL AND progression_category IS NULL
            AND progression_conversation_id IS NULL AND progression_candidate_id IS NULL AND progression_exhausted = false AND progression_waiting = false)
        OR
        (progression_request_id IS NOT NULL AND progression_action IS NOT NULL AND progression_action IN ('ask_another', 'something_else')
            AND progression_category IS NOT NULL AND progression_conversation_id IS NOT NULL
            AND ((progression_candidate_id IS NULL AND (progression_exhausted <> progression_waiting))
                OR (progression_candidate_id IS NOT NULL AND progression_exhausted = false AND progression_waiting = false)))
    );

CREATE UNIQUE INDEX private_round_progression_request_uidx
    ON private_round (pair_id, progression_request_id)
    WHERE progression_request_id IS NOT NULL;
