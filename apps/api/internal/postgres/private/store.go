package private

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	domain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct{ pool *postgres.Pool }

func NewStore(pool *postgres.Pool) *Store { return &Store{pool: pool} }

func (s *Store) StartOrResume(ctx context.Context, input domain.StartInput) (domain.View, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	var conversationID pgtype.UUID
	changed := false
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		if _, err := q.LockPrivatePair(ctx, pairID); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		} else if err != nil {
			return err
		}
		access, err := q.GetPrivatePairAccess(ctx, sqlc.GetPrivatePairAccessParams{PairID: pairID, ParticipantID: participantID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if !domain.CategoryAllowed(string(access.RelationshipType), input.Category) {
			return domain.ErrCategory
		}

		// Open rounds are Pair-wide. Starting another lane converges to the
		// existing exchange instead of creating another candidate.
		if round, err := q.GetActivePrivateRoundForPair(ctx, sqlc.GetActivePrivateRoundForPairParams{PairID: pairID, MembershipEraID: access.MembershipEraID}); err == nil {
			conversationID = round.ConversationID
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		if conversation, err := q.GetCreatorUnresolvedPrivateCandidate(ctx, sqlc.GetCreatorUnresolvedPrivateCandidateParams{
			PairID: pairID, MembershipEraID: access.MembershipEraID, ParticipantID: participantID,
		}); err == nil {
			conversationID = conversation.ConversationID
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		conversation, err := q.GetPrivateConversationByKey(ctx, sqlc.GetPrivateConversationByKeyParams{
			PairID: pairID, MembershipEraID: access.MembershipEraID, Category: input.Category,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			conversation, err = q.CreatePrivateConversation(ctx, sqlc.CreatePrivateConversationParams{
				PairID: pairID, Category: input.Category, CreatedByParticipantID: participantID, MembershipEraID: access.MembershipEraID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				conversation, err = q.GetPrivateConversationByKey(ctx, sqlc.GetPrivateConversationByKeyParams{PairID: pairID, MembershipEraID: access.MembershipEraID, Category: input.Category})
			}
			if err != nil {
				return err
			}
			changed = true
		}
		conversationID = conversation.ID
		if conversation.CreatedByParticipantID == participantID {
			_, candidateErr := q.GetUnresolvedPrivateCandidate(ctx, conversation.ID)
			if errors.Is(candidateErr, pgx.ErrNoRows) {
				consumed, err := q.ListConsumedPrivateQuestionIDs(ctx, conversation.ID)
				if err != nil {
					return err
				}
				eligible, err := q.ListEligiblePrivateQuestions(ctx, sqlc.ListEligiblePrivateQuestionsParams{Category: input.Category, RelationshipType: string(access.RelationshipType)})
				if err != nil {
					return err
				}
				selected, ok := choose(conversation.SelectionSeed, eligible, consumed)
				if ok {
					_, err = q.CreatePrivateQuestionCandidate(ctx, sqlc.CreatePrivateQuestionCandidateParams{ConversationID: conversation.ID, QuestionID: selected.ID, QuestionRevisionID: selected.QuestionRevisionID})
					if err != nil && !errors.Is(err, pgx.ErrNoRows) {
						return err
					}
					changed = true
				}
			} else if candidateErr != nil {
				return candidateErr
			}
		}
		if changed {
			return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
		}
		return nil
	})
	if err != nil {
		return domain.View{}, err
	}
	return s.Read(ctx, domain.ReadInput{ParticipantID: input.ParticipantID, PairID: input.PairID, ConversationID: conversationID.String()})
}

func (s *Store) Read(ctx context.Context, input domain.ReadInput) (domain.View, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	conversationID, err := parseUUID(input.ConversationID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	var result domain.View
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := q.GetPrivatePairAccess(ctx, sqlc.GetPrivatePairAccessParams{PairID: pairID, ParticipantID: participantID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		conversation, err := q.GetPrivateConversation(ctx, sqlc.GetPrivateConversationParams{PairID: pairID, ConversationID: conversationID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		result = domain.View{PairID: input.PairID, ConversationID: input.ConversationID, Category: conversation.Category, CreatorParticipantID: conversation.CreatedByParticipantID.String(), CreatorDisplayName: conversation.CreatorDisplayName}
		if round, err := q.GetOpenPrivateRoundForConversation(ctx, sqlc.GetOpenPrivateRoundForConversationParams{PairID: pairID, ConversationID: conversationID, MembershipEraID: access.MembershipEraID}); err == nil {
			result.State = "CURRENT_ROUND"
			result.Round = roundView(round)
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if conversation.CreatedByParticipantID != participantID {
			result.State = "WAITING_FOR_CREATOR"
			return nil
		}
		candidate, err := q.GetUnresolvedPrivateCandidate(ctx, conversationID)
		if errors.Is(err, pgx.ErrNoRows) {
			result.State = "EXHAUSTED"
			return nil
		}
		if err != nil {
			return err
		}
		if candidate.WithdrawnAt.Valid {
			result.State = "EXHAUSTED"
			return nil
		}
		result.State = "CANDIDATE"
		result.Candidate = &domain.Candidate{ID: candidate.ID.String(), Liked: candidate.LikedAt.Valid, Question: domain.CandidateQuestion{ID: candidate.QuestionID.String(), RevisionID: candidate.QuestionRevisionID.String(), Text: candidate.Text, Category: candidate.Category, Intensity: candidate.Intensity}}
		return nil
	})
	return result, err
}

func (s *Store) Ask(ctx context.Context, input domain.AskInput) (domain.Round, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	conversationID, err := parseUUID(input.ConversationID)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	candidateID, err := parseUUID(input.CandidateID)
	if err != nil {
		return domain.Round{}, domain.ErrCandidate
	}
	requestID := pgtype.UUID{}
	if input.ClientRequestID != "" {
		requestID, err = parseUUID(input.ClientRequestID)
		if err != nil {
			return domain.Round{}, domain.ErrInvalidInput
		}
	}
	var result domain.Round
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, conversation, candidate, err := s.lockCreatorCandidate(ctx, q, pairID, participantID, conversationID, candidateID)
		if err != nil {
			return err
		}
		if candidate.State == sqlc.PrivateQuestionCandidateStateAsked {
			round, roundErr := q.GetPrivateRoundByCandidate(ctx, sqlc.GetPrivateRoundByCandidateParams{CandidateID: candidate.ID, ConversationID: conversation.ID})
			if roundErr != nil {
				return domain.ErrCandidate
			}
			result = roundViewByCandidate(round)
			return nil
		}
		if candidate.State != sqlc.PrivateQuestionCandidateStateUnresolved {
			return domain.ErrCandidate
		}
		if candidate.WithdrawnAt.Valid {
			if err := invalidateCandidate(ctx, q, candidate.ID); err != nil {
				return err
			}
			return domain.ErrCandidate
		}
		if _, err := q.GetActivePrivateRoundForPair(ctx, sqlc.GetActivePrivateRoundForPairParams{PairID: pairID, MembershipEraID: access.MembershipEraID}); err == nil {
			return domain.ErrRoundOpen
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		number, err := q.NextPrivateRoundNumber(ctx, conversation.ID)
		if err != nil {
			return err
		}
		if _, err := q.MarkPrivateCandidateAsked(ctx, sqlc.MarkPrivateCandidateAskedParams{CandidateID: candidate.ID, ConversationID: conversation.ID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrCandidate
			}
			return err
		}
		round, err := q.CreatePrivateRound(ctx, sqlc.CreatePrivateRoundParams{PairID: pairID, ConversationID: conversation.ID, MembershipEraID: access.MembershipEraID, CandidateID: candidate.ID, QuestionID: candidate.QuestionID, QuestionRevisionID: candidate.QuestionRevisionID, RoundNumber: number, ClientRequestID: requestID})
		if err != nil {
			if isUniqueViolation(err) {
				return domain.ErrRoundOpen
			}
			return err
		}
		result = domain.Round{ID: round.ID.String(), PairID: round.PairID.String(), ConversationID: round.ConversationID.String(), MembershipEraID: round.MembershipEraID.String(), CandidateID: round.CandidateID.String(), QuestionID: round.QuestionID.String(), QuestionRevisionID: round.QuestionRevisionID.String(), RoundNumber: round.RoundNumber, State: string(round.Status), AskedAt: timestampString(round.AskedAt), Text: candidate.Text, Category: candidate.Category, Intensity: candidate.Intensity}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	return result, err
}

func (s *Store) Skip(ctx context.Context, input domain.SkipInput) (domain.View, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	conversationID, err := parseUUID(input.ConversationID)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	candidateID, err := parseUUID(input.CandidateID)
	if err != nil {
		return domain.View{}, domain.ErrCandidate
	}
	requestID, err := parseUUID(input.ClientRequestID)
	if err != nil {
		return domain.View{}, domain.ErrInvalidInput
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, conversation, candidate, err := s.lockCreatorCandidate(ctx, q, pairID, participantID, conversationID, candidateID)
		if err != nil {
			return err
		}
		if _, err := q.GetSkippedPrivateCandidateByRequest(ctx, sqlc.GetSkippedPrivateCandidateByRequestParams{ConversationID: conversation.ID, SkipRequestID: requestID}); err == nil {
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if candidate.State != sqlc.PrivateQuestionCandidateStateUnresolved {
			return domain.ErrCandidate
		}
		if candidate.WithdrawnAt.Valid {
			if err := invalidateCandidate(ctx, q, candidate.ID); err != nil {
				return err
			}
			return domain.ErrCandidate
		}
		if _, err := q.MarkPrivateCandidateSkipped(ctx, sqlc.MarkPrivateCandidateSkippedParams{CandidateID: candidate.ID, ConversationID: conversation.ID, SkipRequestID: requestID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrCandidate
			}
			return err
		}
		consumed, err := q.ListConsumedPrivateQuestionIDs(ctx, conversation.ID)
		if err != nil {
			return err
		}
		eligible, err := q.ListEligiblePrivateQuestions(ctx, sqlc.ListEligiblePrivateQuestionsParams{Category: conversation.Category, RelationshipType: string(access.RelationshipType)})
		if err != nil {
			return err
		}
		selected, ok := choose(conversation.SelectionSeed, eligible, consumed)
		resultID := pgtype.UUID{}
		if ok {
			created, err := q.CreatePrivateQuestionCandidate(ctx, sqlc.CreatePrivateQuestionCandidateParams{ConversationID: conversation.ID, QuestionID: selected.ID, QuestionRevisionID: selected.QuestionRevisionID})
			if err != nil {
				return err
			}
			resultID = created.ID
		}
		if err := q.SetPrivateCandidateSkipResult(ctx, sqlc.SetPrivateCandidateSkipResultParams{CandidateID: candidate.ID, SkipResultCandidateID: resultID}); err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.View{}, err
	}
	return s.Read(ctx, domain.ReadInput{ParticipantID: input.ParticipantID, PairID: input.PairID, ConversationID: input.ConversationID})
}

func (s *Store) Like(ctx context.Context, input domain.LikeInput) (bool, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return false, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return false, domain.ErrNotFound
	}
	conversationID, err := parseUUID(input.ConversationID)
	if err != nil {
		return false, domain.ErrNotFound
	}
	candidateID, err := parseUUID(input.CandidateID)
	if err != nil {
		return false, domain.ErrCandidate
	}
	var liked bool
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		_, _, candidate, err := s.lockCreatorCandidate(ctx, q, pairID, participantID, conversationID, candidateID)
		if err != nil {
			return err
		}
		if candidate.State != sqlc.PrivateQuestionCandidateStateUnresolved || candidate.WithdrawnAt.Valid {
			return domain.ErrCandidate
		}
		at, err := q.SetPrivateCandidateLike(ctx, sqlc.SetPrivateCandidateLikeParams{CandidateID: candidate.ID, ConversationID: conversationID, Liked: input.Liked})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrCandidate
		}
		if err != nil {
			return err
		}
		liked = at.Valid
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	return liked, err
}

func (s *Store) lockCreatorCandidate(ctx context.Context, q *sqlc.Queries, pairID, participantID, conversationID, candidateID pgtype.UUID) (sqlc.GetPrivatePairAccessRow, sqlc.GetPrivateConversationRow, sqlc.GetPrivateCandidateForUpdateRow, error) {
	if _, err := q.LockPrivatePair(ctx, pairID); errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, domain.ErrNotFound
	} else if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, err
	}
	access, err := q.GetPrivatePairAccess(ctx, sqlc.GetPrivatePairAccessParams{PairID: pairID, ParticipantID: participantID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, domain.ErrNotFound
	}
	if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, err
	}
	conversation, err := q.GetPrivateConversation(ctx, sqlc.GetPrivateConversationParams{PairID: pairID, ConversationID: conversationID, MembershipEraID: access.MembershipEraID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, domain.ErrNotFound
	}
	if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, err
	}
	if conversation.CreatedByParticipantID != participantID {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, domain.ErrNotFound
	}
	candidate, err := q.GetPrivateCandidateForUpdate(ctx, sqlc.GetPrivateCandidateForUpdateParams{CandidateID: candidateID, ConversationID: conversationID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, domain.ErrCandidate
	}
	if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, sqlc.GetPrivateConversationRow{}, sqlc.GetPrivateCandidateForUpdateRow{}, err
	}
	return access, conversation, candidate, nil
}

func invalidateCandidate(ctx context.Context, q *sqlc.Queries, candidateID pgtype.UUID) error {
	return q.InvalidatePrivateCandidate(ctx, candidateID)
}

func roundView(row sqlc.GetOpenPrivateRoundForConversationRow) *domain.Round {
	return &domain.Round{ID: row.ID.String(), PairID: row.PairID.String(), ConversationID: row.ConversationID.String(), MembershipEraID: row.MembershipEraID.String(), CandidateID: row.CandidateID.String(), QuestionID: row.QuestionID.String(), QuestionRevisionID: row.QuestionRevisionID.String(), RoundNumber: row.RoundNumber, State: string(row.Status), AskedAt: timestampString(row.AskedAt), Text: row.Text, Category: row.Category, Intensity: row.Intensity}
}

func roundViewByCandidate(row sqlc.GetPrivateRoundByCandidateRow) domain.Round {
	return domain.Round{ID: row.ID.String(), PairID: row.PairID.String(), ConversationID: row.ConversationID.String(), MembershipEraID: row.MembershipEraID.String(), CandidateID: row.CandidateID.String(), QuestionID: row.QuestionID.String(), QuestionRevisionID: row.QuestionRevisionID.String(), RoundNumber: row.RoundNumber, State: string(row.Status), AskedAt: timestampString(row.AskedAt), Text: row.Text, Category: row.Category, Intensity: row.Intensity}
}

func timestampString(value pgtype.Timestamptz) string {
	if !value.Valid {
		return ""
	}
	return value.Time.UTC().Format(time.RFC3339Nano)
}

type eligibleQuestion struct {
	ID, QuestionRevisionID    pgtype.UUID
	Text, Category, Intensity string
}

func choose(seed string, questions []sqlc.ListEligiblePrivateQuestionsRow, consumed []pgtype.UUID) (eligibleQuestion, bool) {
	used := make(map[string]struct{}, len(consumed))
	for _, id := range consumed {
		used[id.String()] = struct{}{}
	}
	preferred := domain.PreferredIntensities(0)
	for _, intensity := range preferred {
		candidates := make([]eligibleQuestion, 0)
		for _, question := range questions {
			if _, ok := used[question.ID.String()]; ok || question.Intensity != intensity {
				continue
			}
			candidates = append(candidates, eligibleQuestion{question.ID, question.QuestionRevisionID, question.Text, question.Category, question.Intensity})
		}
		if len(candidates) == 0 {
			continue
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			left := rank(seed, candidates[i].ID.String())
			right := rank(seed, candidates[j].ID.String())
			if left == right {
				return candidates[i].ID.String() < candidates[j].ID.String()
			}
			return left < right
		})
		return candidates[0], true
	}
	return eligibleQuestion{}, false
}

func rank(seed, questionID string) string {
	sum := sha256.Sum256([]byte(seed + ":" + questionID))
	return hex.EncodeToString(sum[:])
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func realtimeEvent(pairID string) realtime.Event {
	return realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PrivateChanged}
}

// InvalidateUnresolvedCandidates is wired into the Question withdrawal
// transaction. It deliberately accepts only the narrow withdrawal executor.
func (s *Store) InvalidateUnresolvedCandidates(ctx context.Context, executor question.WithdrawalExecutor, revisionID string) error {
	id, err := parseUUID(revisionID)
	if err != nil {
		return err
	}
	return executor.Exec(ctx, `
WITH affected AS (
    UPDATE private_question_candidate
    SET state = 'invalidated', resolved_at = COALESCE(resolved_at, now())
    WHERE question_revision_id = $1 AND state = 'unresolved'
    RETURNING conversation_id
)
SELECT pg_notify(
    'closer_realtime',
    json_build_object('version', 1, 'pairId', conversation.pair_id, 'type', 'private.changed')::text
)
FROM affected
JOIN private_conversation AS conversation ON conversation.id = affected.conversation_id`, id)
}
