-- name: ParticipantExists :one
SELECT EXISTS (SELECT 1 FROM participant WHERE id = sqlc.arg(participant_id))::boolean;

-- name: CreatePair :one
INSERT INTO pair (relationship_type, intended_person_name, creation_request_id)
VALUES (sqlc.arg(relationship_type), sqlc.arg(intended_person_name), sqlc.narg(creation_request_id))
ON CONFLICT (creation_request_id) DO NOTHING
RETURNING id, relationship_type, intended_person_name, creation_request_id, terminated_at, created_at;

-- name: GetCreatedPairByRequestAndParticipant :one
SELECT p.id, p.relationship_type, p.intended_person_name, p.creation_request_id, p.terminated_at, p.created_at
FROM pair AS p
JOIN pair_membership AS m ON m.pair_id = p.id
WHERE p.creation_request_id = sqlc.arg(creation_request_id)
  AND m.participant_id = sqlc.arg(participant_id)
  AND m.slot = 'first'
  AND m.ended_at IS NULL;

-- name: CreateCreatorMembership :one
INSERT INTO pair_membership (pair_id, participant_id, slot)
VALUES (sqlc.arg(pair_id), sqlc.arg(participant_id), 'first')
RETURNING id, pair_id, participant_id, slot, started_at, ended_at, ended_display_name;

-- name: ListParticipantSpaces :many
SELECT
    p.id AS pair_id,
    p.relationship_type,
    p.intended_person_name,
    actor_membership.slot AS actor_slot,
    other_participant.id AS other_participant_id,
    other_participant.display_name AS other_participant_display_name,
    CASE WHEN other_membership.id IS NULL THEN 'waiting' ELSE 'connected' END::text AS state
FROM pair AS p
JOIN pair_membership AS actor_membership
    ON actor_membership.pair_id = p.id
   AND actor_membership.participant_id = sqlc.arg(participant_id)
   AND actor_membership.ended_at IS NULL
LEFT JOIN pair_membership AS other_membership
    ON other_membership.pair_id = p.id
   AND other_membership.slot <> actor_membership.slot
   AND other_membership.ended_at IS NULL
LEFT JOIN participant AS other_participant
    ON other_participant.id = other_membership.participant_id
WHERE p.terminated_at IS NULL
ORDER BY p.created_at DESC, p.id DESC;

-- name: GetActivePairAccess :one
SELECT
    p.id AS pair_id,
    p.relationship_type,
    p.intended_person_name,
    p.terminated_at,
    actor_membership.id AS actor_membership_id,
    actor_membership.slot AS actor_slot,
    other_membership.id AS other_membership_id,
    other_membership.participant_id AS other_participant_id,
    other_participant.display_name AS other_participant_display_name,
    active_era.id AS membership_era_id
FROM pair AS p
JOIN pair_membership AS actor_membership
    ON actor_membership.pair_id = p.id
   AND actor_membership.participant_id = sqlc.arg(participant_id)
   AND actor_membership.ended_at IS NULL
LEFT JOIN pair_membership AS other_membership
    ON other_membership.pair_id = p.id
   AND other_membership.slot <> actor_membership.slot
   AND other_membership.ended_at IS NULL
LEFT JOIN participant AS other_participant
    ON other_participant.id = other_membership.participant_id
LEFT JOIN pair_membership_era AS active_era
    ON active_era.pair_id = p.id
   AND active_era.ended_at IS NULL
WHERE p.id = sqlc.arg(pair_id)
  AND p.terminated_at IS NULL;

-- name: ListActivePairMembers :many
SELECT m.participant_id, m.slot, p.display_name
FROM pair_membership AS m
JOIN participant AS p ON p.id = m.participant_id
WHERE m.pair_id = sqlc.arg(pair_id)
  AND m.ended_at IS NULL
ORDER BY m.slot;

-- name: FindFormerTerminatedPair :one
SELECT p.id
FROM pair AS p
JOIN pair_membership AS m ON m.pair_id = p.id
WHERE p.id = sqlc.arg(pair_id)
  AND p.terminated_at IS NOT NULL
  AND m.participant_id = sqlc.arg(participant_id)
LIMIT 1;

-- name: LockActivePair :one
SELECT id
FROM pair
WHERE id = sqlc.arg(pair_id)
  AND terminated_at IS NULL
FOR UPDATE;

-- name: ParticipantHasActiveMembership :one
SELECT EXISTS (
    SELECT 1 FROM pair_membership
    WHERE pair_id = sqlc.arg(pair_id)
      AND participant_id = sqlc.arg(participant_id)
      AND ended_at IS NULL
)::boolean;

-- name: HasActiveSecondSlot :one
SELECT EXISTS (
    SELECT 1 FROM pair_membership
    WHERE pair_id = sqlc.arg(pair_id)
      AND slot = 'second'
      AND ended_at IS NULL
)::boolean;

-- name: UpdateIntendedPersonName :one
UPDATE pair
SET intended_person_name = sqlc.arg(intended_person_name)
WHERE id = sqlc.arg(pair_id)
  AND terminated_at IS NULL
RETURNING id, relationship_type, intended_person_name, creation_request_id, terminated_at, created_at;
