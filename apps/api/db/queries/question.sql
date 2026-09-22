-- name: LockQuestion :one
SELECT id, current_revision_id, is_active, created_at FROM question WHERE id = $1 FOR UPDATE;

-- name: GetQuestion :one
SELECT q.id, q.current_revision_id, q.is_active, q.created_at,
       r.id AS revision_id, r.text, r.category, r.relationship_fit, r.mode_fit,
       r.intensity, r.revision_number, r.created_at AS revision_created_at,
       r.withdrawn_at, r.withdrawn_reason, r.created_by_admin_user_id
FROM question q JOIN question_revision r ON r.id = q.current_revision_id
WHERE q.id = $1;

-- name: ListQuestions :many
SELECT q.id, q.current_revision_id, q.is_active, q.created_at,
       r.text, r.category, r.relationship_fit, r.mode_fit, r.intensity,
       r.revision_number, r.created_at AS revision_created_at, r.withdrawn_at
FROM question q JOIN question_revision r ON r.id = q.current_revision_id
WHERE ($1::text = '' OR r.text ILIKE '%' || $1 || '%')
  AND ($2::text = '' OR r.category = $2)
  AND ($3::text = '' OR r.intensity = $3)
  AND ($4::text = '' OR r.relationship_fit = $4)
  AND ($5::text = '' OR r.mode_fit = $5)
ORDER BY q.created_at DESC, q.id LIMIT $6 OFFSET $7;

-- name: ListQuestionRevisions :many
SELECT id, question_id, text, category, relationship_fit, mode_fit, intensity,
       revision_number, created_by_admin_user_id, withdrawn_at, withdrawn_reason,
       withdrawn_by_admin_user_id, created_at
FROM question_revision WHERE question_id = $1 ORDER BY revision_number DESC;

-- name: FindQuestionDuplicates :many
SELECT q.id, r.text, r.revision_number, q.is_active
FROM question q JOIN question_revision r ON r.id = q.current_revision_id
WHERE lower(btrim(regexp_replace(r.text, '[[:space:]]+', ' ', 'g')))
    = lower(btrim(regexp_replace(sqlc.arg(text), '[[:space:]]+', ' ', 'g')))
  AND (sqlc.arg(exclude_question_id)::text = '' OR q.id::text <> sqlc.arg(exclude_question_id)::text)
ORDER BY q.created_at, q.id;

-- name: CreateQuestion :one
INSERT INTO question (is_active) VALUES (false) RETURNING id, current_revision_id, is_active, created_at;

-- name: CreateQuestionRevision :one
INSERT INTO question_revision (question_id, text, category, relationship_fit, mode_fit, intensity, revision_number, created_by_admin_user_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, question_id, text, category, relationship_fit, mode_fit, intensity, revision_number, created_by_admin_user_id, withdrawn_at, withdrawn_reason, withdrawn_by_admin_user_id, created_at;

-- name: NextQuestionRevisionNumber :one
SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision_number FROM question_revision WHERE question_id = $1;

-- name: GetQuestionRevision :one
SELECT id, question_id, text, category, relationship_fit, mode_fit, intensity,
       revision_number, created_by_admin_user_id, withdrawn_at, withdrawn_reason,
       withdrawn_by_admin_user_id, created_at
FROM question_revision WHERE id = $1 AND question_id = $2;

-- name: SetCurrentQuestionRevision :exec
UPDATE question SET current_revision_id = $2 WHERE id = $1;

-- name: SetQuestionActivity :exec
UPDATE question SET is_active = $2 WHERE id = $1;

-- name: WithdrawQuestionRevision :exec
UPDATE question_revision SET withdrawn_at = COALESCE(withdrawn_at, now()), withdrawn_reason = COALESCE(withdrawn_reason, $3), withdrawn_by_admin_user_id = COALESCE(withdrawn_by_admin_user_id, $4) WHERE id = $1 AND question_id = $2;

-- name: AddQuestionLifecycleEvent :exec
INSERT INTO question_lifecycle_event (question_id, revision_id, action, admin_user_id, reason) VALUES ($1, $2, $3, $4, $5);
