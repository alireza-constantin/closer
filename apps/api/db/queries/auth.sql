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

-- name: CreateRegisteredAuthUser :one
INSERT INTO auth_user (id, kind, created_at)
VALUES ($1, 'registered', $2)
RETURNING id, kind, created_at, disabled_at;

-- name: CreateAuthCredential :exec
INSERT INTO auth_credential (auth_user_id, email_normalized, password_hash, created_at, password_updated_at)
VALUES ($1, $2, $3, $4, $4);

-- name: UpgradeAnonymousAuthUser :execrows
UPDATE auth_user
SET kind = 'registered'
WHERE id = $1 AND kind = 'anonymous' AND disabled_at IS NULL;

-- name: LockAuthUserForUpgrade :one
SELECT id, kind, created_at, disabled_at
FROM auth_user
WHERE id = $1
FOR UPDATE;

-- name: LockAuthUserForRejoin :one
SELECT id, kind, created_at, disabled_at
FROM auth_user
WHERE id = sqlc.arg(auth_user_id)
FOR UPDATE;

-- name: GetCredentialByEmail :one
SELECT u.id AS auth_user_id, u.kind, u.disabled_at, c.password_hash
FROM auth_credential AS c
JOIN auth_user AS u ON u.id = c.auth_user_id
WHERE c.email_normalized = $1;

-- name: UpdateAuthCredentialPasswordHash :exec
UPDATE auth_credential
SET password_hash = $2, password_updated_at = $3
WHERE auth_user_id = $1;

-- name: RevokeAuthSessionsForUser :execrows
UPDATE auth_session
SET revoked_at = $2
WHERE auth_user_id = $1 AND revoked_at IS NULL AND expires_at > $2;

-- name: RevokeAuthSessionByTokenHash :execrows
UPDATE auth_session
SET revoked_at = $2
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: CreateAuthSessionForEnabledRegisteredUser :execrows
INSERT INTO auth_session (id, auth_user_id, token_hash, created_at, expires_at, last_used_at)
SELECT $1, auth_user.id, $3, $4, $5, $4
FROM auth_user
WHERE auth_user.id = $2 AND kind = 'registered' AND disabled_at IS NULL;

-- name: UpsertAuthRateLimit :one
WITH db_clock AS MATERIALIZED (
    SELECT clock_timestamp() AS now
)
INSERT INTO auth_rate_limit (scope, subject, window_started_at, count)
SELECT $1, $2, db_clock.now, 1
FROM db_clock
ON CONFLICT (scope, subject) DO UPDATE
SET count = CASE
        WHEN auth_rate_limit.window_started_at <= (SELECT now FROM db_clock) - interval '1 minute' THEN 1
        ELSE auth_rate_limit.count + 1
    END,
    window_started_at = CASE
        WHEN auth_rate_limit.window_started_at <= (SELECT now FROM db_clock) - interval '1 minute' THEN (SELECT now FROM db_clock)
        ELSE auth_rate_limit.window_started_at
    END
RETURNING count, window_started_at,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_started_at + interval '1 minute' - (SELECT now FROM db_clock)))))::integer AS retry_after_seconds;

-- name: DeleteOldAuthRateLimits :execrows
WITH expired AS (
    SELECT scope, subject
    FROM auth_rate_limit
    WHERE window_started_at <= $1 - interval '1 day'
    ORDER BY window_started_at ASC
    LIMIT 500
    FOR UPDATE SKIP LOCKED
)
DELETE FROM auth_rate_limit AS limits
USING expired
WHERE limits.scope = expired.scope AND limits.subject = expired.subject;

-- name: LockAdminBootstrapEmail :exec
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));

-- name: CreateAdminUser :exec
INSERT INTO admin_user (auth_user_id, created_at)
VALUES ($1, $2);

-- name: HasAdminUser :one
SELECT EXISTS (SELECT 1 FROM admin_user WHERE auth_user_id = $1);

-- name: IsAdminAuthUser :one
SELECT EXISTS (
    SELECT 1
    FROM auth_user AS u
    JOIN admin_user AS a ON a.auth_user_id = u.id
    WHERE u.id = $1 AND u.kind = 'admin' AND u.disabled_at IS NULL
);

-- name: GetAdminCredentialByEmail :one
SELECT u.id AS auth_user_id, u.kind, u.disabled_at, c.password_hash
FROM auth_credential AS c
JOIN auth_user AS u ON u.id = c.auth_user_id
JOIN admin_user AS a ON a.auth_user_id = u.id
WHERE c.email_normalized = $1;

-- name: LockAdminByEmailForRecovery :one
SELECT u.id AS auth_user_id
FROM auth_credential AS c
JOIN auth_user AS u ON u.id = c.auth_user_id
JOIN admin_user AS a ON a.auth_user_id = u.id
WHERE c.email_normalized = $1 AND u.kind = 'admin'
FOR UPDATE OF u, c;

-- name: CreateAuthSessionForEnabledAdminUser :execrows
INSERT INTO auth_session (id, auth_user_id, token_hash, created_at, expires_at, last_used_at)
SELECT $1, u.id, $3, $4, $5, $4
FROM auth_user AS u
JOIN admin_user AS a ON a.auth_user_id = u.id
WHERE u.id = $2 AND u.kind = 'admin' AND u.disabled_at IS NULL;

-- name: UpsertAdminLoginRateLimit :one
WITH db_clock AS MATERIALIZED (
    SELECT clock_timestamp() AS now
)
INSERT INTO auth_rate_limit (scope, subject, window_started_at, count)
SELECT 'admin_login_ip', $1, db_clock.now, 1
FROM db_clock
ON CONFLICT (scope, subject) DO UPDATE
SET count = CASE
        WHEN auth_rate_limit.window_started_at <= (SELECT now FROM db_clock) - interval '1 minute' THEN 1
        ELSE auth_rate_limit.count + 1
    END,
    window_started_at = CASE
        WHEN auth_rate_limit.window_started_at <= (SELECT now FROM db_clock) - interval '1 minute' THEN (SELECT now FROM db_clock)
        ELSE auth_rate_limit.window_started_at
    END
RETURNING count,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_started_at + interval '1 minute' - (SELECT now FROM db_clock)))))::integer AS retry_after_seconds;
