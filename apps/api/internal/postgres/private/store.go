package private

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	domain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
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
		result.State = "CANDIDATE"
		result.Candidate = &domain.Candidate{ID: candidate.ID.String(), Question: domain.CandidateQuestion{ID: candidate.QuestionID.String(), RevisionID: candidate.QuestionRevisionID.String(), Text: candidate.Text, Category: candidate.Category, Intensity: candidate.Intensity}}
		return nil
	})
	return result, err
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

// Kept local to avoid making the transport know about publisher wiring.
func realtimeEvent(pairID string) realtime.Event {
	return realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PrivateChanged}
}
