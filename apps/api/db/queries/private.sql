-- name: GetPrivatePairAccess :one
SELECT
    p.id AS pair_id,
    p.relationship_type,
    actor_membership.id AS actor_membership_id,
    actor_membership.participant_id AS actor_participant_id,
    other_membership.participant_id AS other_participant_id,
    active_era.id AS membership_era_id
FROM pair AS p
JOIN pair_membership AS actor_membership
    ON actor_membership.pair_id = p.id
   AND actor_membership.participant_id = sqlc.arg(participant_id)
   AND actor_membership.ended_at IS NULL
JOIN pair_membership AS other_membership
    ON other_membership.pair_id = p.id
   AND other_membership.slot <> actor_membership.slot
   AND other_membership.ended_at IS NULL
JOIN pair_membership_era AS active_era
    ON active_era.pair_id = p.id
   AND active_era.ended_at IS NULL
WHERE p.id = sqlc.arg(pair_id)
  AND p.terminated_at IS NULL;

-- name: LockPrivatePair :one
SELECT id FROM pair WHERE id = sqlc.arg(pair_id) AND terminated_at IS NULL FOR UPDATE;

-- name: GetPrivateConversationByKey :one
SELECT id, pair_id, category, created_by_participant_id, membership_era_id, created_at, selection_seed
FROM private_conversation
WHERE pair_id = sqlc.arg(pair_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND category = sqlc.arg(category);

-- name: GetCreatorUnresolvedPrivateCandidate :one
SELECT c.id, candidate.conversation_id, c.category
FROM private_question_candidate AS candidate
JOIN private_conversation AS c ON c.id = candidate.conversation_id
WHERE c.pair_id = sqlc.arg(pair_id)
  AND c.membership_era_id = sqlc.arg(membership_era_id)
  AND c.created_by_participant_id = sqlc.arg(participant_id)
  AND candidate.state = 'unresolved'
LIMIT 1;

-- name: CreatePrivateConversation :one
INSERT INTO private_conversation (pair_id, category, created_by_participant_id, membership_era_id)
VALUES (sqlc.arg(pair_id), sqlc.arg(category), sqlc.arg(created_by_participant_id), sqlc.arg(membership_era_id))
ON CONFLICT (pair_id, membership_era_id, category) DO NOTHING
RETURNING id, pair_id, category, created_by_participant_id, membership_era_id, created_at, selection_seed;

-- name: GetPrivateConversation :one
SELECT c.id, c.pair_id, c.category, c.created_by_participant_id, c.membership_era_id,
       c.created_at, c.selection_seed, creator.display_name AS creator_display_name
FROM private_conversation AS c
JOIN participant AS creator ON creator.id = c.created_by_participant_id
WHERE c.id = sqlc.arg(conversation_id)
  AND c.pair_id = sqlc.arg(pair_id)
  AND c.membership_era_id = sqlc.arg(membership_era_id);

-- name: GetUnresolvedPrivateCandidate :one
SELECT c.id, c.conversation_id, c.question_id, c.question_revision_id, c.state,
       c.created_at, c.resolved_at, r.text, r.category, r.intensity
FROM private_question_candidate AS c
JOIN question_revision AS r ON r.id = c.question_revision_id
WHERE c.conversation_id = sqlc.arg(conversation_id)
  AND c.state = 'unresolved'
LIMIT 1;

-- name: ListConsumedPrivateQuestionIDs :many
SELECT question_id FROM private_question_candidate
WHERE conversation_id = sqlc.arg(conversation_id) AND state IN ('asked', 'skipped');

-- name: ListEligiblePrivateQuestions :many
SELECT q.id, r.id AS question_revision_id, r.text, r.category, r.intensity
FROM question AS q
JOIN question_revision AS r ON r.id = q.current_revision_id
WHERE q.is_active = true
  AND r.category = sqlc.arg(category)
  AND r.relationship_fit IN ('both', sqlc.arg(relationship_type))
  AND r.mode_fit IN ('both', 'private')
  AND r.withdrawn_at IS NULL
ORDER BY q.id;

-- name: CreatePrivateQuestionCandidate :one
INSERT INTO private_question_candidate (conversation_id, question_id, question_revision_id)
VALUES (sqlc.arg(conversation_id), sqlc.arg(question_id), sqlc.arg(question_revision_id))
ON CONFLICT (conversation_id) WHERE state = 'unresolved' DO NOTHING
RETURNING id, conversation_id, question_id, question_revision_id, state, created_at, resolved_at;

-- name: InvalidatePrivateCandidatesForRevision :exec
UPDATE private_question_candidate
SET state = 'invalidated', resolved_at = COALESCE(resolved_at, now())
WHERE question_revision_id = sqlc.arg(question_revision_id) AND state = 'unresolved';
