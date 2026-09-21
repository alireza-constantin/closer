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
