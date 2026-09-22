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
