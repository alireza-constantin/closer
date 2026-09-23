ALTER TABLE private_round
    DROP CONSTRAINT private_round_retirement_consistent,
    ADD CONSTRAINT private_round_retirement_consistent CHECK (
        (status IN ('open', 'completed') AND declined_by_membership_id IS NULL AND declined_at IS NULL)
        OR
        (status = 'retired' AND declined_by_membership_id IS NOT NULL AND declined_at IS NOT NULL)
    );

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
