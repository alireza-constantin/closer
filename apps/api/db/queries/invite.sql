-- name: FindInitialInviteForIssue :one
SELECT id, expires_at
FROM initial_invite
WHERE pair_id = sqlc.arg(pair_id)
  AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at > clock_timestamp()
ORDER BY created_at DESC
LIMIT 1;

-- name: RevokeNonterminalInitialInvites :exec
UPDATE initial_invite SET revoked_at = clock_timestamp()
WHERE pair_id = sqlc.arg(pair_id) AND revoked_at IS NULL AND redeemed_at IS NULL;

-- name: CreateInitialInvite :one
INSERT INTO initial_invite (pair_id, token_hash, issued_by_participant_id, expires_at)
VALUES (sqlc.arg(pair_id), sqlc.arg(token_hash), sqlc.arg(issued_by_participant_id), sqlc.arg(expires_at))
RETURNING id, expires_at;

-- name: RevokeUsableInitialInvite :execrows
UPDATE initial_invite SET revoked_at = clock_timestamp()
WHERE pair_id = sqlc.arg(pair_id) AND revoked_at IS NULL AND redeemed_at IS NULL;

-- name: GetInitialInviteLanding :one
SELECT p.id AS pair_id, first_participant.display_name AS inviter_display_name,
       p.relationship_type, p.intended_person_name, i.expires_at
FROM initial_invite i
JOIN pair p ON p.id = i.pair_id
JOIN pair_membership first_membership ON first_membership.pair_id = p.id
 AND first_membership.slot = 'first' AND first_membership.ended_at IS NULL
JOIN participant first_participant ON first_participant.id = first_membership.participant_id
WHERE i.token_hash = sqlc.arg(token_hash) AND i.revoked_at IS NULL AND i.redeemed_at IS NULL
  AND i.expires_at > clock_timestamp() AND p.terminated_at IS NULL;

-- name: GetInitialInviteStatus :one
SELECT i.expires_at
FROM pair p
JOIN pair_membership m ON m.pair_id = p.id
 AND m.slot = 'first' AND m.ended_at IS NULL
JOIN initial_invite i ON i.pair_id = p.id
 AND i.revoked_at IS NULL AND i.redeemed_at IS NULL
 AND i.expires_at > clock_timestamp()
WHERE p.id = sqlc.arg(pair_id)
  AND p.terminated_at IS NULL
  AND m.participant_id = sqlc.arg(participant_id)
  AND NOT EXISTS (
    SELECT 1 FROM pair_membership s
    WHERE s.pair_id = p.id AND s.slot = 'second' AND s.ended_at IS NULL
  )
ORDER BY i.created_at DESC
LIMIT 1;

-- Resolve the Pair without taking the invite lock. Claim acquires Pair then
-- invite, matching issue/revoke/termination lock ordering.
-- name: GetInitialInvitePairByHash :one
SELECT id, pair_id FROM initial_invite WHERE token_hash = sqlc.arg(token_hash);

-- name: GetInitialInviteForUpdate :one
SELECT id, pair_id, issued_by_participant_id, expires_at, revoked_at, redeemed_at
FROM initial_invite WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: LockPairForInitialClaim :one
SELECT id, terminated_at, intended_person_name
FROM pair WHERE id = sqlc.arg(pair_id) FOR UPDATE;

-- name: GetActiveFirstMembershipForClaim :one
SELECT id, participant_id FROM pair_membership
WHERE pair_id = sqlc.arg(pair_id) AND slot = 'first' AND ended_at IS NULL;

-- name: GetActiveSecondMembershipForClaim :one
SELECT id FROM pair_membership
WHERE pair_id = sqlc.arg(pair_id) AND slot = 'second' AND ended_at IS NULL;

-- name: LockClaimParticipantPair :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text, 0));

-- name: HasDuplicateActiveParticipantPair :one
SELECT EXISTS (
  SELECT 1 FROM pair_membership first_member
  JOIN pair_membership second_member ON second_member.pair_id = first_member.pair_id
  JOIN pair_membership_era era ON era.pair_id = first_member.pair_id AND era.ended_at IS NULL
  JOIN pair other_pair ON other_pair.id = first_member.pair_id AND other_pair.terminated_at IS NULL
  WHERE first_member.pair_id <> sqlc.arg(excluded_pair_id)
    AND first_member.ended_at IS NULL AND second_member.ended_at IS NULL
    AND (
      (first_member.participant_id = sqlc.arg(participant_a)
       AND second_member.participant_id = sqlc.arg(participant_b))
      OR
      (first_member.participant_id = sqlc.arg(participant_b)
       AND second_member.participant_id = sqlc.arg(participant_a))
    )
)::boolean;

-- name: RedeemInitialInvite :execrows
UPDATE initial_invite SET redeemed_at = clock_timestamp(), redeemed_by_participant_id = sqlc.arg(participant_id)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at > clock_timestamp();

-- name: CreateClaimMembership :one
INSERT INTO pair_membership (pair_id, participant_id, slot)
VALUES (sqlc.arg(pair_id), sqlc.arg(participant_id), 'second')
RETURNING id;

-- name: CreateInitialMembershipEra :one
INSERT INTO pair_membership_era (pair_id, first_membership_id, second_membership_id)
VALUES (sqlc.arg(pair_id), sqlc.arg(first_membership_id), sqlc.arg(second_membership_id))
RETURNING id;

-- name: ClearIntendedPersonName :exec
UPDATE pair SET intended_person_name = NULL WHERE id = sqlc.arg(pair_id);

-- name: GetRejoinInviteLanding :one
SELECT target_slot
FROM rejoin_invite AS i
JOIN pair AS p ON p.id = i.pair_id
WHERE i.token_hash = sqlc.arg(token_hash)
  AND p.terminated_at IS NULL
  AND i.revoked_at IS NULL
  AND i.redeemed_at IS NULL
  AND i.expires_at > clock_timestamp();

-- name: LockActivePairForRejoin :one
SELECT id, terminated_at
FROM pair
WHERE id = sqlc.arg(pair_id)
FOR UPDATE;

-- name: GetActiveMembershipForRejoinActor :one
SELECT m.id, m.pair_id, m.participant_id, m.slot, p.display_name,
       u.id AS auth_user_id, u.kind AS auth_user_kind
FROM pair_membership AS m
JOIN participant AS p ON p.id = m.participant_id
JOIN auth_user AS u ON u.id = p.auth_user_id
WHERE m.pair_id = sqlc.arg(pair_id)
  AND m.participant_id = sqlc.arg(participant_id)
  AND m.ended_at IS NULL;

-- name: GetEligibleRejoinTarget :one
SELECT m.id, m.pair_id, m.participant_id, m.slot, p.display_name,
       u.id AS auth_user_id, u.kind AS auth_user_kind
FROM pair_membership AS m
JOIN participant AS p ON p.id = m.participant_id
JOIN auth_user AS u ON u.id = p.auth_user_id
WHERE m.pair_id = sqlc.arg(pair_id)
  AND m.slot = sqlc.arg(target_slot)
  AND m.ended_at IS NULL;

-- name: LockTargetMembershipForRejoin :one
SELECT m.id, m.pair_id, m.participant_id, m.slot, p.display_name,
       p.auth_user_id, u.kind AS auth_user_kind
FROM pair_membership AS m
JOIN participant AS p ON p.id = m.participant_id
JOIN auth_user AS u ON u.id = p.auth_user_id
WHERE m.pair_id = sqlc.arg(pair_id)
  AND m.slot = sqlc.arg(target_slot)
  AND m.participant_id = sqlc.arg(target_participant_id)
  AND m.ended_at IS NULL
FOR UPDATE OF m, p, u;

-- name: GetCurrentMembershipEraForRejoin :one
SELECT id, pair_id, first_membership_id, second_membership_id
FROM pair_membership_era
WHERE pair_id = sqlc.arg(pair_id) AND ended_at IS NULL
FOR UPDATE;

-- name: FindRejoinInviteForIssue :one
SELECT id, expires_at
FROM rejoin_invite
WHERE pair_id = sqlc.arg(pair_id)
  AND target_slot = sqlc.arg(target_slot)
  AND target_participant_id = sqlc.arg(target_participant_id)
  AND revoked_at IS NULL AND redeemed_at IS NULL
  AND expires_at > clock_timestamp()
ORDER BY created_at DESC
LIMIT 1;

-- name: RevokeActiveRejoinInvitesForTarget :exec
UPDATE rejoin_invite SET revoked_at = clock_timestamp()
WHERE pair_id = sqlc.arg(pair_id)
  AND target_slot = sqlc.arg(target_slot)
  AND target_participant_id = sqlc.arg(target_participant_id)
  AND revoked_at IS NULL AND redeemed_at IS NULL;

-- name: RevokeAllActiveRejoinInvitesForPair :exec
UPDATE rejoin_invite SET revoked_at = clock_timestamp()
WHERE pair_id = sqlc.arg(pair_id) AND revoked_at IS NULL AND redeemed_at IS NULL;

-- name: CreateRejoinInvite :one
INSERT INTO rejoin_invite (pair_id, target_slot, target_participant_id, token_hash, expires_at)
VALUES (sqlc.arg(pair_id), sqlc.arg(target_slot), sqlc.arg(target_participant_id), sqlc.arg(token_hash), sqlc.arg(expires_at))
RETURNING id, expires_at;

-- name: GetRejoinInviteByHash :one
SELECT id, pair_id, target_slot, target_participant_id, expires_at, revoked_at, redeemed_at
FROM rejoin_invite
WHERE token_hash = sqlc.arg(token_hash);

-- name: GetRejoinInviteForUpdate :one
SELECT id, pair_id, target_slot, target_participant_id, expires_at, revoked_at, redeemed_at
FROM rejoin_invite
WHERE id = sqlc.arg(id)
FOR UPDATE;

-- name: HasActiveAuthSessionForRejoinTarget :one
SELECT EXISTS (
    SELECT 1 FROM auth_session
    WHERE auth_user_id = sqlc.arg(auth_user_id)
      AND revoked_at IS NULL AND expires_at > clock_timestamp()
)::boolean;

-- name: RedeemRejoinInvite :execrows
UPDATE rejoin_invite
SET redeemed_at = clock_timestamp(), redeemed_by_participant_id = sqlc.arg(participant_id)
WHERE id = sqlc.arg(id)
  AND revoked_at IS NULL AND redeemed_at IS NULL
  AND expires_at > clock_timestamp();

-- name: RebindParticipantAuthUserForRejoin :execrows
UPDATE participant
SET auth_user_id = sqlc.arg(new_auth_user_id), updated_at = clock_timestamp()
WHERE id = sqlc.arg(participant_id)
  AND auth_user_id = sqlc.arg(old_auth_user_id);
