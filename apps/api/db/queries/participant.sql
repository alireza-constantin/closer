-- name: GetParticipantByAuthUserID :one
SELECT id, auth_user_id, display_name, created_at, updated_at
FROM participant
WHERE auth_user_id = sqlc.arg(auth_user_id);

-- name: CreateParticipant :one
INSERT INTO participant (auth_user_id, display_name)
VALUES (sqlc.arg(auth_user_id), sqlc.arg(display_name))
ON CONFLICT (auth_user_id) DO NOTHING
RETURNING id, auth_user_id, display_name, created_at, updated_at;

-- name: GetParticipantByID :one
SELECT id, auth_user_id, display_name, created_at, updated_at
FROM participant
WHERE id = sqlc.arg(id);
