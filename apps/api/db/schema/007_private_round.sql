ALTER TABLE private_question_candidate
    ADD COLUMN liked_at timestamptz,
    ADD COLUMN skip_request_id uuid,
    ADD COLUMN skip_result_candidate_id uuid REFERENCES private_question_candidate(id) ON DELETE RESTRICT;

ALTER TABLE private_question_candidate
    ADD CONSTRAINT private_candidate_terminal_fields_consistent CHECK (
        (state = 'unresolved' AND resolved_at IS NULL AND skip_request_id IS NULL AND skip_result_candidate_id IS NULL)
        OR
        (state = 'asked' AND resolved_at IS NOT NULL AND skip_request_id IS NULL AND skip_result_candidate_id IS NULL)
        OR
        (state = 'skipped' AND resolved_at IS NOT NULL AND skip_request_id IS NOT NULL)
        OR
        (state = 'invalidated' AND resolved_at IS NOT NULL AND skip_request_id IS NULL AND skip_result_candidate_id IS NULL)
    );

ALTER TABLE private_question_candidate
    ADD CONSTRAINT private_candidate_identity_unique UNIQUE (id, question_id, question_revision_id);

ALTER TABLE pair_membership_era
    ADD CONSTRAINT pair_membership_era_pair_id_id_unique UNIQUE (pair_id, id);

CREATE UNIQUE INDEX private_candidate_skip_request_uidx
    ON private_question_candidate (conversation_id, skip_request_id)
    WHERE skip_request_id IS NOT NULL;

CREATE TYPE private_round_status AS ENUM ('open', 'closed');

CREATE TABLE private_round (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL,
    membership_era_id uuid NOT NULL REFERENCES pair_membership_era(id) ON DELETE RESTRICT,
    candidate_id uuid NOT NULL UNIQUE REFERENCES private_question_candidate(id) ON DELETE RESTRICT,
    question_id uuid NOT NULL REFERENCES question(id) ON DELETE RESTRICT,
    question_revision_id uuid NOT NULL REFERENCES question_revision(id) ON DELETE RESTRICT,
    round_number integer NOT NULL CHECK (round_number > 0),
    status private_round_status NOT NULL DEFAULT 'open',
    asked_at timestamptz NOT NULL DEFAULT now(),
    client_request_id uuid,
    CONSTRAINT private_round_pair_conversation_consistent_fk
        FOREIGN KEY (pair_id, conversation_id)
        REFERENCES private_conversation(pair_id, id) ON DELETE CASCADE,
    CONSTRAINT private_round_candidate_question_revision_fk
        FOREIGN KEY (candidate_id, question_id, question_revision_id)
        REFERENCES private_question_candidate(id, question_id, question_revision_id) ON DELETE RESTRICT,
    CONSTRAINT private_round_conversation_number_unique UNIQUE (conversation_id, round_number),
    CONSTRAINT private_round_pair_era_unique FOREIGN KEY (pair_id, membership_era_id)
        REFERENCES pair_membership_era(pair_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX private_round_one_open_pair_uidx
    ON private_round (pair_id, membership_era_id)
    WHERE status = 'open';

CREATE UNIQUE INDEX private_round_request_uidx
    ON private_round (pair_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE INDEX private_round_conversation_idx
    ON private_round (conversation_id, round_number);
