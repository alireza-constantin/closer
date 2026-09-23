CREATE TABLE auth_user (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('anonymous', 'registered', 'admin')),
    created_at timestamptz NOT NULL,
    disabled_at timestamptz
);

CREATE TABLE auth_session (
    id uuid PRIMARY KEY,
    auth_user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE INDEX auth_session_auth_user_id_expires_at_idx
    ON auth_session (auth_user_id, expires_at);
CREATE INDEX auth_session_expires_at_idx
    ON auth_session (expires_at);

CREATE TABLE auth_credential (
    auth_user_id uuid PRIMARY KEY REFERENCES auth_user(id) ON DELETE RESTRICT,
    email_normalized text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL,
    password_updated_at timestamptz NOT NULL
);

CREATE TABLE auth_rate_limit (
    scope text NOT NULL,
    subject text NOT NULL,
    window_started_at timestamptz NOT NULL,
    count integer NOT NULL CHECK (count >= 0),
    PRIMARY KEY (scope, subject)
);

CREATE INDEX auth_rate_limit_window_started_at_idx
    ON auth_rate_limit (window_started_at);

CREATE TABLE admin_user (
    auth_user_id uuid PRIMARY KEY REFERENCES auth_user(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL
);

CREATE TYPE pair_relationship_type AS ENUM ('partner', 'friend');
CREATE TYPE pair_slot AS ENUM ('first', 'second');

CREATE TABLE participant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT participant_display_name_valid
        CHECK (char_length(display_name) BETWEEN 1 AND 40 AND display_name = btrim(display_name))
);
CREATE UNIQUE INDEX participant_auth_user_id_uidx ON participant (auth_user_id);

CREATE TABLE pair (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_type pair_relationship_type NOT NULL,
    intended_person_name text,
    creation_request_id uuid,
    terminated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pair_intended_person_name_valid
        CHECK (
            intended_person_name IS NULL OR
            (char_length(intended_person_name) BETWEEN 1 AND 40 AND intended_person_name = btrim(intended_person_name))
        )
);
CREATE UNIQUE INDEX pair_creation_request_uidx ON pair (creation_request_id);

CREATE TABLE pair_membership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    slot pair_slot NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    ended_display_name text
);

CREATE UNIQUE INDEX pair_membership_one_active_slot_uidx
    ON pair_membership (pair_id, slot) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX pair_membership_one_active_participant_uidx
    ON pair_membership (pair_id, participant_id) WHERE ended_at IS NULL;
CREATE INDEX pair_membership_active_participant_idx
    ON pair_membership (participant_id, pair_id) WHERE ended_at IS NULL;

-- The first era starts only when the second slot is claimed in GO-05.
CREATE TABLE pair_membership_era (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    first_membership_id uuid NOT NULL REFERENCES pair_membership(id) ON DELETE RESTRICT,
    second_membership_id uuid NOT NULL REFERENCES pair_membership(id) ON DELETE RESTRICT,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);

CREATE UNIQUE INDEX pair_membership_era_one_active_uidx
    ON pair_membership_era (pair_id) WHERE ended_at IS NULL;
CREATE INDEX pair_membership_era_pair_started_idx
    ON pair_membership_era (pair_id, started_at);

CREATE TABLE initial_invite (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    issued_by_participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    redeemed_at timestamptz,
    redeemed_by_participant_id uuid REFERENCES participant(id) ON DELETE RESTRICT,
    CONSTRAINT initial_invite_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT initial_invite_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT initial_invite_redemption_consistent CHECK ((redeemed_at IS NULL) = (redeemed_by_participant_id IS NULL)),
    CONSTRAINT initial_invite_terminal_exclusive CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
);

CREATE UNIQUE INDEX initial_invite_one_usable_per_pair_uidx
    ON initial_invite (pair_id)
    WHERE revoked_at IS NULL AND redeemed_at IS NULL;
CREATE INDEX initial_invite_pair_created_idx ON initial_invite (pair_id, created_at DESC);

ALTER TABLE pair_membership
    ADD CONSTRAINT pair_membership_id_pair_slot_unique UNIQUE (id, pair_id, slot);
ALTER TABLE pair_membership_era
    ADD COLUMN first_slot pair_slot NOT NULL DEFAULT 'first',
    ADD COLUMN second_slot pair_slot NOT NULL DEFAULT 'second',
    ADD CONSTRAINT pair_membership_era_first_slot CHECK (first_slot = 'first'),
    ADD CONSTRAINT pair_membership_era_second_slot CHECK (second_slot = 'second'),
    ADD CONSTRAINT pair_membership_era_first_exact_membership
        FOREIGN KEY (first_membership_id, pair_id, first_slot)
        REFERENCES pair_membership (id, pair_id, slot) ON DELETE RESTRICT,
    ADD CONSTRAINT pair_membership_era_second_exact_membership
        FOREIGN KEY (second_membership_id, pair_id, second_slot)
        REFERENCES pair_membership (id, pair_id, slot) ON DELETE RESTRICT;

CREATE TABLE rejoin_invite (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    target_slot pair_slot NOT NULL,
    target_participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    redeemed_at timestamptz,
    redeemed_by_participant_id uuid REFERENCES participant(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rejoin_invite_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT rejoin_invite_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT rejoin_invite_redemption_consistent CHECK ((redeemed_at IS NULL) = (redeemed_by_participant_id IS NULL)),
    CONSTRAINT rejoin_invite_terminal_exclusive CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
);

CREATE INDEX rejoin_invite_pair_idx ON rejoin_invite (pair_id);
CREATE INDEX rejoin_invite_target_idx ON rejoin_invite (pair_id, target_slot, target_participant_id);

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

CREATE TYPE private_question_candidate_state AS ENUM ('unresolved', 'asked', 'skipped', 'invalidated');

CREATE TABLE private_conversation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_id uuid NOT NULL REFERENCES pair(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (category IN ('fun', 'deep', 'memories', 'relationship', 'friendship')),
    created_by_participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    membership_era_id uuid NOT NULL REFERENCES pair_membership_era(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    selection_seed text NOT NULL DEFAULT gen_random_uuid()::text,
    CONSTRAINT private_conversation_pair_id_id_key UNIQUE (pair_id, id),
    CONSTRAINT private_conversation_one_era_category_key UNIQUE (pair_id, membership_era_id, category)
);
CREATE INDEX private_conversation_pair_created_idx ON private_conversation (pair_id, created_at);

CREATE TABLE private_question_candidate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES private_conversation(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES question(id) ON DELETE RESTRICT,
    question_revision_id uuid NOT NULL REFERENCES question_revision(id) ON DELETE RESTRICT,
    state private_question_candidate_state NOT NULL DEFAULT 'unresolved',
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT private_candidate_question_revision_belongs_to_question_fk
        FOREIGN KEY (question_id, question_revision_id)
        REFERENCES question_revision(question_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX private_candidate_one_unresolved_uidx
    ON private_question_candidate (conversation_id) WHERE state = 'unresolved';
CREATE INDEX private_candidate_conversation_created_idx
    ON private_question_candidate (conversation_id, created_at);

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
CREATE UNIQUE INDEX together_session_one_active_pair_uidx
    ON together_session (pair_id)
    WHERE ended_at IS NULL;

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

CREATE TYPE private_round_status AS ENUM ('open', 'completed', 'retired');

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
    declined_by_membership_id uuid REFERENCES pair_membership(id) ON DELETE RESTRICT,
    declined_at timestamptz,
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
        REFERENCES pair_membership_era(pair_id, id) ON DELETE RESTRICT,
    CONSTRAINT private_round_id_era_unique UNIQUE (id, membership_era_id),
    CONSTRAINT private_round_retirement_consistent CHECK (
        (status IN ('open', 'completed') AND declined_by_membership_id IS NULL AND declined_at IS NULL)
        OR
        (status = 'retired' AND declined_by_membership_id IS NOT NULL AND declined_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX private_round_one_open_pair_uidx
    ON private_round (pair_id, membership_era_id)
    WHERE status = 'open';

CREATE UNIQUE INDEX private_round_request_uidx
    ON private_round (pair_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE INDEX private_round_conversation_idx
    ON private_round (conversation_id, round_number);

ALTER TABLE pair_membership
    ADD CONSTRAINT pair_membership_pair_id_id_unique UNIQUE (pair_id, id);

ALTER TABLE pair_membership
    ADD CONSTRAINT pair_membership_id_participant_unique UNIQUE (id, participant_id);

CREATE TABLE private_answer (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL REFERENCES private_round(id) ON DELETE CASCADE,
    membership_era_id uuid NOT NULL REFERENCES pair_membership_era(id) ON DELETE RESTRICT,
    membership_id uuid NOT NULL REFERENCES pair_membership(id) ON DELETE RESTRICT,
    participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT private_answer_body_valid
        CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
    CONSTRAINT private_answer_round_membership_uidx UNIQUE (round_id, membership_id),
    CONSTRAINT private_answer_round_participant_uidx UNIQUE (round_id, participant_id),
    CONSTRAINT private_answer_round_era_fk
        FOREIGN KEY (round_id, membership_era_id)
        REFERENCES private_round(id, membership_era_id) ON DELETE CASCADE,
    CONSTRAINT private_answer_membership_participant_fk
        FOREIGN KEY (membership_id, participant_id)
        REFERENCES pair_membership(id, participant_id) ON DELETE RESTRICT
);

CREATE INDEX private_answer_round_idx ON private_answer (round_id);

CREATE TABLE private_reveal_view (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL REFERENCES private_round(id) ON DELETE CASCADE,
    membership_era_id uuid NOT NULL REFERENCES pair_membership_era(id) ON DELETE RESTRICT,
    membership_id uuid NOT NULL REFERENCES pair_membership(id) ON DELETE RESTRICT,
    participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT private_reveal_round_membership_uidx UNIQUE (round_id, membership_id),
    CONSTRAINT private_reveal_round_era_fk
        FOREIGN KEY (round_id, membership_era_id)
        REFERENCES private_round(id, membership_era_id) ON DELETE CASCADE,
    CONSTRAINT private_reveal_membership_participant_fk
        FOREIGN KEY (membership_id, participant_id)
        REFERENCES pair_membership(id, participant_id) ON DELETE RESTRICT
);

CREATE INDEX private_reveal_round_idx ON private_reveal_view (round_id);

CREATE TYPE private_reaction_value AS ENUM ('heart', 'laugh', 'tender', 'surprised');

CREATE TABLE private_reaction (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL,
    membership_era_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    value private_reaction_value NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT private_reaction_round_membership_uidx UNIQUE (round_id, membership_id),
    CONSTRAINT private_reaction_round_participant_uidx UNIQUE (round_id, participant_id),
    CONSTRAINT private_reaction_round_era_fk FOREIGN KEY (round_id, membership_era_id)
        REFERENCES private_round(id, membership_era_id) ON DELETE CASCADE,
    CONSTRAINT private_reaction_membership_participant_fk FOREIGN KEY (membership_id, participant_id)
        REFERENCES pair_membership(id, participant_id) ON DELETE RESTRICT
);

CREATE INDEX private_reaction_round_idx ON private_reaction (round_id);

CREATE TABLE private_reply (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL,
    membership_era_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT private_reply_body_valid
        CHECK (char_length(body) BETWEEN 1 AND 500 AND body = btrim(body)),
    CONSTRAINT private_reply_round_membership_uidx UNIQUE (round_id, membership_id),
    CONSTRAINT private_reply_round_participant_uidx UNIQUE (round_id, participant_id),
    CONSTRAINT private_reply_round_era_fk FOREIGN KEY (round_id, membership_era_id)
        REFERENCES private_round(id, membership_era_id) ON DELETE CASCADE,
    CONSTRAINT private_reply_membership_participant_fk FOREIGN KEY (membership_id, participant_id)
        REFERENCES pair_membership(id, participant_id) ON DELETE RESTRICT
);

CREATE INDEX private_reply_round_idx ON private_reply (round_id);

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

-- Aggregate access paths: analytics filters by the pinned logical Question and
-- exact revision before joining the owning Conversation or Session for Pair ID.
CREATE INDEX private_candidate_analytics_question_revision_idx
    ON private_question_candidate (question_id, question_revision_id, conversation_id);

CREATE INDEX together_question_analytics_question_revision_idx
    ON together_session_question (question_id, question_revision_id, session_id);
