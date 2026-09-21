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
