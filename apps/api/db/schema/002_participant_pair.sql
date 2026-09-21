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
