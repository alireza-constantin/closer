CREATE TABLE question (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    current_revision_id uuid,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES question(id) ON DELETE RESTRICT,
    text text NOT NULL,
    category text NOT NULL CHECK (category IN ('fun', 'deep', 'memories', 'relationship', 'friendship')),
    relationship_fit text NOT NULL CHECK (relationship_fit IN ('both', 'partner', 'friend')),
    mode_fit text NOT NULL CHECK (mode_fit IN ('both', 'together', 'private')),
    intensity text NOT NULL CHECK (intensity IN ('light', 'medium', 'deep')),
    revision_number integer NOT NULL CHECK (revision_number > 0),
    created_by_admin_user_id uuid REFERENCES auth_user(id) ON DELETE RESTRICT,
    withdrawn_at timestamptz,
    withdrawn_reason text,
    withdrawn_by_admin_user_id uuid REFERENCES auth_user(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT question_revision_text_not_blank CHECK (char_length(btrim(text)) > 0),
    CONSTRAINT question_revision_number_unique UNIQUE (question_id, revision_number),
    CONSTRAINT question_revision_id_question_unique UNIQUE (question_id, id),
    CONSTRAINT question_revision_relationship_fit_valid CHECK (
        (category NOT IN ('relationship', 'friendship')) OR
        (category = 'relationship' AND relationship_fit = 'partner') OR
        (category = 'friendship' AND relationship_fit = 'friend')
    )
);

ALTER TABLE question
    ADD CONSTRAINT question_current_revision_question_fk
    FOREIGN KEY (id, current_revision_id)
    REFERENCES question_revision(question_id, id)
    ON DELETE RESTRICT;

CREATE INDEX question_selection_idx ON question (is_active, current_revision_id);
CREATE INDEX question_revision_selection_idx ON question_revision (category, mode_fit, relationship_fit, intensity);
CREATE INDEX question_revision_question_created_idx ON question_revision (question_id, created_at);

CREATE TABLE question_lifecycle_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES question(id) ON DELETE RESTRICT,
    revision_id uuid,
    action text NOT NULL CHECK (action IN ('activated', 'reactivated', 'deactivated', 'revision_withdrawn')),
    admin_user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    reason text,
    CONSTRAINT question_lifecycle_revision_question_fk FOREIGN KEY (question_id, revision_id) REFERENCES question_revision(question_id, id) ON DELETE RESTRICT,
    CONSTRAINT question_lifecycle_withdrawal_reason_required CHECK (action <> 'revision_withdrawn' OR (revision_id IS NOT NULL AND char_length(btrim(reason)) > 0))
);
CREATE INDEX question_lifecycle_event_question_occurred_idx ON question_lifecycle_event (question_id, occurred_at);
