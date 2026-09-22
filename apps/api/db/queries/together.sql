-- name: CreateTogetherSession :one
INSERT INTO together_session (pair_id, membership_era_id, category, started_by_participant_id, start_request_id, selection_seed)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, pair_id, membership_era_id, category, started_by_participant_id, start_request_id, selection_seed, started_at, ended_at;

-- name: CreateTogetherSessionQuestion :one
INSERT INTO together_session_question (session_id, question_id, question_revision_id, position)
VALUES ($1, $2, $3, $4)
RETURNING id, session_id, question_id, question_revision_id, position, shown_at, liked_at, skipped_at, advanced_at, advance_request_id;

-- name: ClosePreclaimTogetherSessions :exec
UPDATE together_session SET ended_at = COALESCE(ended_at, clock_timestamp())
WHERE pair_id = $1 AND membership_era_id IS NULL AND ended_at IS NULL;
