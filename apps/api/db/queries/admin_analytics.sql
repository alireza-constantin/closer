-- name: GetAdminAnalyticsQuestion :one
SELECT q.id, q.current_revision_id, current_revision.revision_number
FROM question q
JOIN question_revision current_revision
  ON current_revision.id = q.current_revision_id
WHERE q.id = $1;

-- name: GetAdminAnalyticsRevision :one
SELECT id, revision_number
FROM question_revision
WHERE question_id = $1 AND id = $2;

-- name: GetAdminPrivateQuestionAnalytics :one
SELECT
    count(*) FILTER (WHERE c.state IN ('unresolved', 'asked', 'skipped'))::bigint AS valid_offers,
    count(*) FILTER (WHERE c.state IN ('asked', 'skipped'))::bigint AS decisions,
    count(*) FILTER (WHERE c.state = 'asked')::bigint AS asked,
    count(*) FILTER (WHERE c.state = 'skipped')::bigint AS skipped,
    count(*) FILTER (WHERE c.state IN ('asked', 'skipped') AND c.liked_at IS NOT NULL)::bigint AS liked_decisions
FROM private_question_candidate c
JOIN private_conversation pc ON pc.id = c.conversation_id
WHERE c.question_id = $1
  AND ($2::uuid IS NULL OR c.question_revision_id = $2)
  AND c.state IN ('unresolved', 'asked', 'skipped')
HAVING count(DISTINCT pc.pair_id) >= sqlc.arg(min_distinct_pairs)::bigint
   AND (
       $2::uuid IS NOT NULL
       OR NOT EXISTS (
           SELECT 1
           FROM private_question_candidate scoped_c
           JOIN private_conversation scoped_pc ON scoped_pc.id = scoped_c.conversation_id
           WHERE scoped_c.question_id = $1
             AND scoped_c.state IN ('unresolved', 'asked', 'skipped')
           GROUP BY scoped_c.question_revision_id
           HAVING count(DISTINCT scoped_pc.pair_id) < sqlc.arg(min_distinct_pairs)::bigint
       )
   );

-- name: GetAdminTogetherQuestionAnalytics :one
SELECT
    count(*)::bigint AS shown,
    count(*) FILTER (WHERE tsq.advanced_at IS NOT NULL)::bigint AS decisions,
    count(*) FILTER (WHERE tsq.advanced_at IS NOT NULL AND tsq.skipped_at IS NULL)::bigint AS continued,
    count(*) FILTER (WHERE tsq.advanced_at IS NOT NULL AND tsq.skipped_at IS NOT NULL)::bigint AS skipped,
    count(*) FILTER (WHERE tsq.advanced_at IS NOT NULL AND tsq.liked_at IS NOT NULL)::bigint AS liked_decisions
FROM together_session_question tsq
JOIN together_session ts ON ts.id = tsq.session_id
WHERE tsq.question_id = $1
  AND ($2::uuid IS NULL OR tsq.question_revision_id = $2)
HAVING count(DISTINCT ts.pair_id) >= sqlc.arg(min_distinct_pairs)::bigint
   AND (
       $2::uuid IS NOT NULL
       OR NOT EXISTS (
           SELECT 1
           FROM together_session_question scoped_tsq
           JOIN together_session scoped_ts ON scoped_ts.id = scoped_tsq.session_id
           WHERE scoped_tsq.question_id = $1
           GROUP BY scoped_tsq.question_revision_id
           HAVING count(DISTINCT scoped_ts.pair_id) < sqlc.arg(min_distinct_pairs)::bigint
       )
   );

-- name: GetAdminQuestionCoverage :many
SELECT
    qr.category,
    count(qr.id)::bigint AS eligible,
    count(qr.id) FILTER (WHERE qr.intensity = 'light')::bigint AS light,
    count(qr.id) FILTER (WHERE qr.intensity = 'medium')::bigint AS medium,
    count(qr.id) FILTER (WHERE qr.intensity = 'deep')::bigint AS deep
FROM question q
JOIN question_revision qr ON qr.id = q.current_revision_id
WHERE q.is_active
  AND qr.withdrawn_at IS NULL
  AND (qr.relationship_fit = 'both' OR qr.relationship_fit = sqlc.arg(relationship_type)::text)
  AND (qr.mode_fit = 'both' OR qr.mode_fit = sqlc.arg(mode)::text)
GROUP BY qr.category
ORDER BY qr.category;
