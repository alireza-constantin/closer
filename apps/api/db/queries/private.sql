-- name: GetPrivatePairAccess :one
SELECT
    p.id AS pair_id,
    p.relationship_type,
    actor_membership.id AS actor_membership_id,
    other_membership.id AS other_membership_id,
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

-- name: ListPrivateHistoryRounds :many
-- A participant can read only rounds from membership eras in which that exact
-- participant took part. Open and retired rounds are not paired history.
SELECT round.id, round.membership_era_id, round.round_number, round.asked_at,
       revision.text, revision.category, revision.intensity,
       viewer_membership.id AS viewer_membership_id
FROM private_round AS round
JOIN pair_membership_era AS era
  ON era.id = round.membership_era_id AND era.pair_id = round.pair_id
JOIN question_revision AS revision ON revision.id = round.question_revision_id
JOIN pair_membership AS viewer_membership
  ON viewer_membership.participant_id = sqlc.arg(participant_id)
 AND (viewer_membership.id = era.first_membership_id OR viewer_membership.id = era.second_membership_id)
WHERE round.pair_id = sqlc.arg(pair_id)
  AND round.status = 'completed'
  AND (SELECT count(*) FROM private_answer AS answer
       WHERE answer.round_id = round.id AND answer.membership_era_id = round.membership_era_id) = 2
  AND (SELECT count(*) FROM private_reveal_view AS reveal
       WHERE reveal.round_id = round.id AND reveal.membership_era_id = round.membership_era_id) = 2
  AND (sqlc.narg(before_asked_at)::timestamptz IS NULL
       OR round.asked_at < sqlc.narg(before_asked_at)
       OR (round.asked_at = sqlc.narg(before_asked_at) AND round.id < sqlc.narg(before_round_id)))
ORDER BY round.asked_at DESC, round.id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetPrivateHistoryAccess :one
SELECT pair.id
FROM pair
JOIN pair_membership AS membership ON membership.pair_id = pair.id
WHERE pair.id = sqlc.arg(pair_id) AND membership.participant_id = sqlc.arg(participant_id)
LIMIT 1;

-- name: ListPrivateHistoryAnswers :many
SELECT answer.body, COALESCE(membership.ended_display_name, participant.display_name) AS display_name
FROM private_answer AS answer
JOIN pair_membership AS membership ON membership.id = answer.membership_id
JOIN participant ON participant.id = answer.participant_id
WHERE answer.round_id = sqlc.arg(round_id) AND answer.membership_era_id = sqlc.arg(membership_era_id)
ORDER BY answer.created_at, answer.id;

-- name: ListPrivateHistoryReactions :many
SELECT reaction.value, COALESCE(membership.ended_display_name, participant.display_name) AS display_name
FROM private_reaction AS reaction
JOIN pair_membership AS membership ON membership.id = reaction.membership_id
JOIN participant ON participant.id = reaction.participant_id
WHERE reaction.round_id = sqlc.arg(round_id) AND reaction.membership_era_id = sqlc.arg(membership_era_id)
ORDER BY reaction.membership_id;

-- name: ListPrivateHistoryReplies :many
SELECT reply.body, COALESCE(membership.ended_display_name, participant.display_name) AS display_name
FROM private_reply AS reply
JOIN pair_membership AS membership ON membership.id = reply.membership_id
JOIN participant ON participant.id = reply.participant_id
WHERE reply.round_id = sqlc.arg(round_id) AND reply.membership_era_id = sqlc.arg(membership_era_id)
ORDER BY reply.created_at, reply.membership_id;

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
       c.created_at, c.resolved_at, c.liked_at, r.text, r.category, r.intensity,
       r.withdrawn_at
FROM private_question_candidate AS c
JOIN question_revision AS r ON r.id = c.question_revision_id
WHERE c.conversation_id = sqlc.arg(conversation_id)
  AND c.state = 'unresolved'
LIMIT 1;

-- name: GetPrivateCandidateForUpdate :one
SELECT c.id, c.conversation_id, c.question_id, c.question_revision_id, c.state,
       c.created_at, c.resolved_at, c.liked_at, c.skip_request_id,
       c.skip_result_candidate_id, r.text, r.category, r.intensity, r.withdrawn_at
FROM private_question_candidate AS c
JOIN question_revision AS r ON r.id = c.question_revision_id
WHERE c.id = sqlc.arg(candidate_id)
  AND c.conversation_id = sqlc.arg(conversation_id)
FOR UPDATE;

-- name: ListConsumedPrivateQuestionIDs :many
SELECT question_id FROM private_question_candidate
WHERE conversation_id = sqlc.arg(conversation_id) AND state IN ('asked', 'skipped');

-- name: GetActivePrivateRoundForPair :one
SELECT id, pair_id, conversation_id, membership_era_id, candidate_id, question_id,
       question_revision_id, round_number, status, asked_at, client_request_id
FROM private_round
WHERE pair_id = sqlc.arg(pair_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND status = 'open'
ORDER BY asked_at DESC
LIMIT 1;

-- name: GetOpenPrivateRoundForConversation :one
SELECT round.id, round.pair_id, round.conversation_id, round.membership_era_id, round.candidate_id, round.question_id,
       round.question_revision_id, round.round_number, round.status, round.asked_at, round.client_request_id,
       r.text, r.category, r.intensity
FROM private_round AS round
JOIN question_revision AS r ON r.id = round.question_revision_id
WHERE round.pair_id = sqlc.arg(pair_id)
  AND round.conversation_id = sqlc.arg(conversation_id)
  AND round.membership_era_id = sqlc.arg(membership_era_id)
  AND round.status = 'open'
ORDER BY round.round_number DESC
LIMIT 1;

-- name: GetLatestCompletedPrivateRoundForConversation :one
SELECT round.id, round.pair_id, round.conversation_id, round.membership_era_id, round.candidate_id, round.question_id,
       round.question_revision_id, round.round_number, round.status, round.asked_at, round.client_request_id,
       round.progression_exhausted, round.progression_waiting,
       r.text, r.category, r.intensity
FROM private_round AS round
JOIN question_revision AS r ON r.id = round.question_revision_id
WHERE round.pair_id = sqlc.arg(pair_id)
  AND round.conversation_id = sqlc.arg(conversation_id)
  AND round.membership_era_id = sqlc.arg(membership_era_id)
  AND round.status IN ('completed', 'retired')
ORDER BY round.round_number DESC
LIMIT 1;

-- name: CountPrivateRoundsForConversation :one
SELECT COUNT(*)::integer FROM private_round
WHERE conversation_id = sqlc.arg(conversation_id);

-- name: CountMutuallyCompletedPrivateRounds :one
SELECT COUNT(*)::integer FROM private_round
WHERE conversation_id = sqlc.arg(conversation_id) AND status = 'completed';

-- name: GetPrivateRoundForParticipant :one
SELECT round.id, round.pair_id, round.conversation_id, round.membership_era_id,
       round.candidate_id, round.question_id, round.question_revision_id,
       round.round_number, round.status, round.asked_at, round.client_request_id,
       round.declined_by_membership_id, round.declined_at, round.progression_request_id,
       round.progression_action, round.progression_category, round.progression_conversation_id,
       round.progression_candidate_id, round.progression_exhausted,
       round.progression_waiting,
       r.text, r.category, r.intensity
FROM private_round AS round
JOIN question_revision AS r ON r.id = round.question_revision_id
WHERE round.id = sqlc.arg(round_id)
  AND round.pair_id = sqlc.arg(pair_id)
  AND round.membership_era_id = sqlc.arg(membership_era_id);

-- name: ListPrivateAnswers :many
SELECT id, round_id, membership_era_id, membership_id, participant_id, body, created_at
FROM private_answer
WHERE round_id = sqlc.arg(round_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
ORDER BY created_at, id;

-- name: GetPrivateAnswerByMembership :one
SELECT id, round_id, membership_era_id, membership_id, participant_id, body, created_at
FROM private_answer
WHERE round_id = sqlc.arg(round_id)
  AND membership_id = sqlc.arg(membership_id)
  AND membership_era_id = sqlc.arg(membership_era_id);

-- name: CreatePrivateAnswer :one
INSERT INTO private_answer (round_id, membership_era_id, membership_id, participant_id, body)
VALUES (sqlc.arg(round_id), sqlc.arg(membership_era_id), sqlc.arg(membership_id), sqlc.arg(participant_id), sqlc.arg(body))
ON CONFLICT (round_id, membership_id) DO NOTHING
RETURNING id, round_id, membership_era_id, membership_id, participant_id, body, created_at;

-- name: RetirePrivateRound :one
UPDATE private_round
SET status = 'retired', declined_by_membership_id = sqlc.arg(membership_id), declined_at = now()
WHERE id = sqlc.arg(round_id)
  AND pair_id = sqlc.arg(pair_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND status = 'open'
RETURNING id;

-- name: ListPrivateRevealViews :many
SELECT id, round_id, membership_era_id, membership_id, participant_id, viewed_at
FROM private_reveal_view
WHERE round_id = sqlc.arg(round_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
ORDER BY viewed_at, id;

-- name: CreatePrivateRevealView :one
INSERT INTO private_reveal_view (round_id, membership_era_id, membership_id, participant_id)
VALUES (sqlc.arg(round_id), sqlc.arg(membership_era_id), sqlc.arg(membership_id), sqlc.arg(participant_id))
ON CONFLICT (round_id, membership_id) DO NOTHING
RETURNING id, round_id, membership_era_id, membership_id, participant_id, viewed_at;

-- name: CompletePrivateRound :execrows
UPDATE private_round
SET status = 'completed'
WHERE id = sqlc.arg(round_id)
  AND pair_id = sqlc.arg(pair_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND status = 'open';

-- name: SetPrivateRoundProgression :execrows
UPDATE private_round
SET progression_request_id = sqlc.arg(client_request_id),
    progression_action = sqlc.arg(action),
    progression_category = sqlc.arg(category),
    progression_conversation_id = sqlc.arg(conversation_id),
    progression_candidate_id = sqlc.narg(candidate_id),
    progression_exhausted = sqlc.arg(exhausted),
    progression_waiting = sqlc.arg(waiting)
WHERE id = sqlc.arg(round_id)
  AND pair_id = sqlc.arg(pair_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND status IN ('completed', 'retired')
  AND progression_request_id IS NULL;

-- name: ListPrivateReactions :many
SELECT reaction.round_id, reaction.membership_id, reaction.participant_id,
       participant.display_name, reaction.value
FROM private_reaction AS reaction
JOIN pair_membership AS membership ON membership.id = reaction.membership_id
JOIN participant ON participant.id = reaction.participant_id
WHERE reaction.round_id = sqlc.arg(round_id)
  AND reaction.membership_era_id = sqlc.arg(membership_era_id)
ORDER BY reaction.id;

-- name: ListPrivateReplies :many
SELECT reply.round_id, reply.membership_id, reply.participant_id,
       participant.display_name, reply.body
FROM private_reply AS reply
JOIN pair_membership AS membership ON membership.id = reply.membership_id
JOIN participant ON participant.id = reply.participant_id
WHERE reply.round_id = sqlc.arg(round_id)
  AND reply.membership_era_id = sqlc.arg(membership_era_id)
ORDER BY reply.created_at, reply.id;

-- name: UpsertPrivateReaction :one
INSERT INTO private_reaction (round_id, membership_era_id, membership_id, participant_id, value)
VALUES (sqlc.arg(round_id), sqlc.arg(membership_era_id), sqlc.arg(membership_id), sqlc.arg(participant_id), sqlc.arg(value))
ON CONFLICT (round_id, membership_id) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
RETURNING id;

-- name: DeletePrivateReaction :exec
DELETE FROM private_reaction
WHERE round_id = sqlc.arg(round_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND membership_id = sqlc.arg(membership_id);

-- name: UpsertPrivateReply :one
INSERT INTO private_reply (round_id, membership_era_id, membership_id, participant_id, body)
VALUES (sqlc.arg(round_id), sqlc.arg(membership_era_id), sqlc.arg(membership_id), sqlc.arg(participant_id), sqlc.arg(body))
ON CONFLICT (round_id, membership_id) DO UPDATE
SET body = EXCLUDED.body, updated_at = now()
RETURNING id;

-- name: DeletePrivateReply :exec
DELETE FROM private_reply
WHERE round_id = sqlc.arg(round_id)
  AND membership_era_id = sqlc.arg(membership_era_id)
  AND membership_id = sqlc.arg(membership_id);

-- name: GetPrivateRoundByCandidate :one
SELECT round.id, round.pair_id, round.conversation_id, round.membership_era_id, round.candidate_id, round.question_id,
       round.question_revision_id, round.round_number, round.status, round.asked_at, round.client_request_id,
       r.text, r.category, r.intensity
FROM private_round AS round
JOIN question_revision AS r ON r.id = round.question_revision_id
WHERE round.candidate_id = sqlc.arg(candidate_id)
  AND round.conversation_id = sqlc.arg(conversation_id)
LIMIT 1;

-- name: NextPrivateRoundNumber :one
SELECT (COALESCE(MAX(round_number), 0) + 1)::integer AS round_number
FROM private_round
WHERE conversation_id = sqlc.arg(conversation_id);

-- name: GetSkippedPrivateCandidateByRequest :one
SELECT id, conversation_id, skip_result_candidate_id
FROM private_question_candidate
WHERE conversation_id = sqlc.arg(conversation_id)
  AND skip_request_id = sqlc.arg(skip_request_id)
LIMIT 1;

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

-- name: MarkPrivateCandidateAsked :one
UPDATE private_question_candidate
SET state = 'asked', resolved_at = now()
WHERE id = sqlc.arg(candidate_id)
  AND conversation_id = sqlc.arg(conversation_id)
  AND state = 'unresolved'
RETURNING id;

-- name: MarkPrivateCandidateSkipped :one
UPDATE private_question_candidate
SET state = 'skipped', resolved_at = now(), skip_request_id = sqlc.arg(skip_request_id)
WHERE id = sqlc.arg(candidate_id)
  AND conversation_id = sqlc.arg(conversation_id)
  AND state = 'unresolved'
RETURNING id;

-- name: SetPrivateCandidateSkipResult :exec
UPDATE private_question_candidate
SET skip_result_candidate_id = sqlc.arg(skip_result_candidate_id)
WHERE id = sqlc.arg(candidate_id)
  AND state = 'skipped';

-- name: SetPrivateCandidateLike :one
UPDATE private_question_candidate
SET liked_at = CASE WHEN sqlc.arg(liked)::boolean THEN now() ELSE NULL END
WHERE id = sqlc.arg(candidate_id)
  AND conversation_id = sqlc.arg(conversation_id)
  AND state = 'unresolved'
RETURNING liked_at;

-- name: InvalidatePrivateCandidate :exec
UPDATE private_question_candidate
SET state = 'invalidated', resolved_at = COALESCE(resolved_at, now())
WHERE id = sqlc.arg(candidate_id) AND state = 'unresolved';

-- name: CreatePrivateRound :one
INSERT INTO private_round (
    pair_id, conversation_id, membership_era_id, candidate_id,
    question_id, question_revision_id, round_number, client_request_id
)
VALUES (
    sqlc.arg(pair_id), sqlc.arg(conversation_id), sqlc.arg(membership_era_id), sqlc.arg(candidate_id),
    sqlc.arg(question_id), sqlc.arg(question_revision_id), sqlc.arg(round_number), sqlc.arg(client_request_id)
)
RETURNING id, pair_id, conversation_id, membership_era_id, candidate_id, question_id,
          question_revision_id, round_number, status, asked_at, client_request_id;

-- name: InvalidatePrivateCandidatesForRevision :exec
UPDATE private_question_candidate
SET state = 'invalidated', resolved_at = COALESCE(resolved_at, now())
WHERE question_revision_id = sqlc.arg(question_revision_id) AND state = 'unresolved';
