-- name: CreateAuthUser :one
INSERT INTO auth_user (id, kind, created_at)
VALUES ($1, $2, $3)
RETURNING id, kind, created_at, disabled_at;

-- name: CreateAuthSession :one
INSERT INTO auth_session (
    id, auth_user_id, token_hash, created_at, expires_at, last_used_at
)
VALUES ($1, $2, $3, $4, $5, $4)
RETURNING id, auth_user_id, token_hash, created_at, expires_at, last_used_at, revoked_at;

-- name: GetAuthSessionActor :one
SELECT
    s.id AS session_id,
    u.id AS auth_user_id,
    u.kind,
    u.created_at AS user_created_at,
    s.created_at AS session_created_at,
    s.expires_at,
    s.last_used_at
FROM auth_session AS s
JOIN auth_user AS u ON u.id = s.auth_user_id
WHERE s.token_hash = sqlc.arg(token_hash)
  AND s.expires_at > sqlc.arg(now)
  AND s.revoked_at IS NULL
  AND u.disabled_at IS NULL;

-- name: RenewAuthSession :one
UPDATE auth_session
SET expires_at = $2, last_used_at = $3
WHERE id = $1
  AND expires_at > $3
  AND revoked_at IS NULL
RETURNING expires_at;

-- name: RevokeAuthSession :execrows
UPDATE auth_session
SET revoked_at = $2
WHERE token_hash = $1
  AND revoked_at IS NULL;

-- name: DeleteExpiredAuthSessions :execrows
WITH expired AS (
    SELECT candidate.id
    FROM auth_session AS candidate
    WHERE candidate.expires_at <= $1 OR candidate.revoked_at IS NOT NULL
    ORDER BY candidate.expires_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
)
DELETE FROM auth_session AS session
USING expired
WHERE session.id = expired.id;

-- name: HasAuthSession :one
SELECT EXISTS (
    SELECT 1 FROM auth_session WHERE token_hash = $1
);

-- name: ListAuthSessionTokenHashes :many
SELECT token_hash
FROM auth_session
WHERE auth_user_id = $1;
