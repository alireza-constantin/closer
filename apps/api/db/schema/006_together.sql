CREATE TABLE together_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    membership_era_id uuid REFERENCES pair_membership_era(id) ON DELETE RESTRICT,
    category text NOT NULL CHECK (category IN ('fun', 'deep', 'memories', 'relationship', 'friendship')),
    started_by_participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    start_request_id uuid,
    selection_seed text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    CONSTRAINT together_session_pair_id_id_unique UNIQUE (pair_id, id)
);

CREATE UNIQUE INDEX together_session_start_request_uidx
    ON together_session (pair_id, started_by_participant_id, start_request_id)
    WHERE start_request_id IS NOT NULL;
CREATE INDEX together_session_pair_started_idx ON together_session (pair_id, started_at);

CREATE TABLE together_session_question (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES together_session(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES question(id) ON DELETE RESTRICT,
    question_revision_id uuid NOT NULL REFERENCES question_revision(id) ON DELETE RESTRICT,
    position integer NOT NULL CHECK (position > 0),
    shown_at timestamptz NOT NULL DEFAULT now(),
    liked_at timestamptz,
    skipped_at timestamptz,
    advanced_at timestamptz,
    advance_request_id uuid,
    CONSTRAINT together_session_question_revision_belongs_to_question_fk
        FOREIGN KEY (question_id, question_revision_id)
        REFERENCES question_revision(question_id, id) ON DELETE RESTRICT,
    CONSTRAINT together_session_question_once UNIQUE (session_id, question_id),
    CONSTRAINT together_session_question_position UNIQUE (session_id, position)
);

CREATE UNIQUE INDEX together_session_question_advance_request_uidx
    ON together_session_question (session_id, advance_request_id)
    WHERE advance_request_id IS NOT NULL;
CREATE INDEX together_session_question_current_idx
    ON together_session_question (session_id, advanced_at);
