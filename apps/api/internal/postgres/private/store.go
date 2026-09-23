package private

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

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
			roundCount, err := q.CountPrivateRoundsForConversation(ctx, conversation.ID)
			if err != nil {
				return err
			}
			// Existing Conversations advance only after an explicit creator action.
			if roundCount > 0 {
				return nil
			}
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
				completedCount, err := q.CountMutuallyCompletedPrivateRounds(ctx, conversation.ID)
				if err != nil {
					return err
				}
				selected, ok := choose(conversation.SelectionSeed, eligible, consumed, int(completedCount))
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
		result = domain.View{PairID: input.PairID, ConversationID: input.ConversationID, Category: conversation.Category, CreatorParticipantID: conversation.CreatedByParticipantID.String(), CreatorDisplayName: conversation.CreatorDisplayName, AvailableCategories: availablePrivateCategories(string(access.RelationshipType))}
		if round, err := q.GetOpenPrivateRoundForConversation(ctx, sqlc.GetOpenPrivateRoundForConversationParams{PairID: pairID, ConversationID: conversationID, MembershipEraID: access.MembershipEraID}); err == nil {
			result.State = "CURRENT_ROUND"
			result.Round = roundView(round)
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		completedRound, completedErr := q.GetLatestCompletedPrivateRoundForConversation(ctx, sqlc.GetLatestCompletedPrivateRoundForConversationParams{PairID: pairID, ConversationID: conversationID, MembershipEraID: access.MembershipEraID})
		if completedErr != nil && !errors.Is(completedErr, pgx.ErrNoRows) {
			return completedErr
		}
		if conversation.CreatedByParticipantID == participantID {
			candidate, candidateErr := q.GetUnresolvedPrivateCandidate(ctx, conversationID)
			if candidateErr == nil {
				if candidate.WithdrawnAt.Valid {
					result.State = "EXHAUSTED"
					return nil
				}
				result.State = "CANDIDATE"
				result.Candidate = &domain.Candidate{ID: candidate.ID.String(), Liked: candidate.LikedAt.Valid, Question: domain.CandidateQuestion{ID: candidate.QuestionID.String(), RevisionID: candidate.QuestionRevisionID.String(), Text: candidate.Text, Category: candidate.Category, Intensity: candidate.Intensity}}
				return nil
			} else if !errors.Is(candidateErr, pgx.ErrNoRows) {
				return candidateErr
			}
		} else {
			_, candidateErr := q.GetCreatorUnresolvedPrivateCandidate(ctx, sqlc.GetCreatorUnresolvedPrivateCandidateParams{PairID: pairID, MembershipEraID: access.MembershipEraID, ParticipantID: conversation.CreatedByParticipantID})
			if candidateErr == nil {
				result.State = "WAITING_FOR_CREATOR"
				return nil
			}
			if !errors.Is(candidateErr, pgx.ErrNoRows) {
				return candidateErr
			}
		}
		if completedErr == nil && completedRound.ProgressionExhausted {
			result.State = "EXHAUSTED"
			return nil
		}
		if completedErr == nil {
			result.State = "CURRENT_ROUND"
			projected, err := s.roundProjection(ctx, q, domain.RoundInput{ParticipantID: participantID.String(), PairID: input.PairID, RoundID: completedRound.ID.String()}, completedRound.ID, pairID, access)
			if err != nil {
				return err
			}
			result.Round = &projected
			return nil
		}
		if conversation.CreatedByParticipantID != participantID {
			result.State = "WAITING_FOR_CREATOR"
			return nil
		}
		result.State = "EXHAUSTED"
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
		completedCount, err := q.CountMutuallyCompletedPrivateRounds(ctx, conversation.ID)
		if err != nil {
			return err
		}
		selected, ok := choose(conversation.SelectionSeed, eligible, consumed, int(completedCount))
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

func (s *Store) GetRound(ctx context.Context, input domain.RoundInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	var result domain.Round
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := q.GetPrivatePairAccess(ctx, sqlc.GetPrivatePairAccessParams{PairID: pairID, ParticipantID: participantID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		result, err = s.roundProjection(ctx, q, input, roundID, pairID, access)
		return err
	})
	return result, err
}

func (s *Store) History(ctx context.Context, input domain.HistoryInput) (domain.HistoryPage, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.HistoryPage{}, domain.ErrNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.HistoryPage{}, domain.ErrNotFound
	}
	beforeAt := pgtype.Timestamptz{}
	beforeID := pgtype.UUID{}
	if input.BeforeAskedAt != "" || input.BeforeRoundID != "" {
		if input.BeforeAskedAt == "" || input.BeforeRoundID == "" {
			return domain.HistoryPage{}, domain.ErrHistoryCursor
		}
		parsedAt, parseErr := time.Parse(time.RFC3339Nano, input.BeforeAskedAt)
		if parseErr != nil {
			return domain.HistoryPage{}, domain.ErrHistoryCursor
		}
		beforeAt = pgtype.Timestamptz{Time: parsedAt, Valid: true}
		beforeID, err = parseUUID(input.BeforeRoundID)
		if err != nil {
			return domain.HistoryPage{}, domain.ErrHistoryCursor
		}
	}
	var result domain.HistoryPage
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		if _, err := db.Exec(ctx, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); err != nil {
			return err
		}
		q := sqlc.New(db)
		if _, err := q.GetPrivateHistoryAccess(ctx, sqlc.GetPrivateHistoryAccessParams{ParticipantID: participantID, PairID: pairID}); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		} else if err != nil {
			return err
		}
		rows, err := q.ListPrivateHistoryRounds(ctx, sqlc.ListPrivateHistoryRoundsParams{
			ParticipantID: participantID, PairID: pairID, BeforeAskedAt: beforeAt, BeforeRoundID: beforeID, PageLimit: input.Limit + 1,
		})
		if err != nil {
			return err
		}
		result.Rounds = make([]domain.HistoryRound, 0, len(rows))
		for _, row := range rows {
			item := domain.HistoryRound{ID: row.ID.String(), AskedAt: timestampString(row.AskedAt), Text: row.Text, Category: row.Category, Intensity: row.Intensity, RoundNumber: row.RoundNumber}
			answers, err := q.ListPrivateHistoryAnswers(ctx, sqlc.ListPrivateHistoryAnswersParams{RoundID: row.ID, MembershipEraID: row.MembershipEraID})
			if err != nil {
				return err
			}
			item.Answers = make([]domain.HistoryAnswer, 0, len(answers))
			for _, answer := range answers {
				item.Answers = append(item.Answers, domain.HistoryAnswer{DisplayName: answer.DisplayName, Body: answer.Body})
			}
			reactions, err := q.ListPrivateHistoryReactions(ctx, sqlc.ListPrivateHistoryReactionsParams{RoundID: row.ID, MembershipEraID: row.MembershipEraID})
			if err != nil {
				return err
			}
			item.Reactions = make([]domain.HistoryReaction, 0, len(reactions))
			for _, reaction := range reactions {
				item.Reactions = append(item.Reactions, domain.HistoryReaction{DisplayName: reaction.DisplayName, Value: string(reaction.Value)})
			}
			replies, err := q.ListPrivateHistoryReplies(ctx, sqlc.ListPrivateHistoryRepliesParams{RoundID: row.ID, MembershipEraID: row.MembershipEraID})
			if err != nil {
				return err
			}
			item.Replies = make([]domain.HistoryReply, 0, len(replies))
			for _, reply := range replies {
				item.Replies = append(item.Replies, domain.HistoryReply{DisplayName: reply.DisplayName, Body: reply.Body})
			}
			result.Rounds = append(result.Rounds, item)
		}
		return nil
	})
	return result, err
}

func (s *Store) Answer(ctx context.Context, input domain.AnswerInput) (domain.Round, error) {
	body := strings.TrimSpace(input.Body)
	if body == "" || utf8.RuneCountInString(body) > 2000 {
		return domain.Round{}, domain.ErrAnswerInvalid
	}
	pairID, participantID, roundID, err := parseRoundIDs(input.RoundInput)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if round.Status != sqlc.PrivateRoundStatusOpen {
			return domain.ErrQuestionUnavailable
		}
		created, err := q.CreatePrivateAnswer(ctx, sqlc.CreatePrivateAnswerParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID, ParticipantID: participantID, Body: body})
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := q.GetPrivateAnswerByMembership(ctx, sqlc.GetPrivateAnswerByMembershipParams{RoundID: roundID, MembershipID: access.ActorMembershipID, MembershipEraID: access.MembershipEraID})
			if getErr != nil {
				return getErr
			}
			if existing.Body != body {
				return domain.ErrAnswerImmutable
			}
		} else if err != nil {
			return err
		} else if created.Body != body {
			return domain.ErrAnswerImmutable
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input.RoundInput)
}

func (s *Store) Decline(ctx context.Context, input domain.RoundInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if round.Status != sqlc.PrivateRoundStatusOpen {
			if round.DeclinedByMembershipID == access.ActorMembershipID {
				return nil
			}
			return domain.ErrQuestionUnavailable
		}
		answers, err := q.ListPrivateAnswers(ctx, sqlc.ListPrivateAnswersParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return err
		}
		for _, answer := range answers {
			if answer.MembershipID == access.ActorMembershipID {
				return domain.ErrQuestionUnavailable
			}
		}
		if len(answers) >= 2 {
			return domain.ErrQuestionUnavailable
		}
		if _, err := q.RetirePrivateRound(ctx, sqlc.RetirePrivateRoundParams{MembershipID: access.ActorMembershipID, RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID}); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrQuestionUnavailable
		} else if err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input)
}

func (s *Store) Reveal(ctx context.Context, input domain.RoundInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if round.Status != sqlc.PrivateRoundStatusOpen && round.Status != sqlc.PrivateRoundStatusCompleted {
			return domain.ErrRevealNotReady
		}
		answers, err := q.ListPrivateAnswers(ctx, sqlc.ListPrivateAnswersParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return err
		}
		if len(answers) != 2 {
			return domain.ErrRevealNotReady
		}
		_, err = q.CreatePrivateRevealView(ctx, sqlc.CreatePrivateRevealViewParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID, ParticipantID: participantID})
		if errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
		if err != nil {
			return err
		}
		reveals, err := q.ListPrivateRevealViews(ctx, sqlc.ListPrivateRevealViewsParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return err
		}
		if len(reveals) == 2 && round.Status == sqlc.PrivateRoundStatusOpen {
			if _, err := q.CompletePrivateRound(ctx, sqlc.CompletePrivateRoundParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID}); err != nil {
				return err
			}
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input)
}

func (s *Store) SetReaction(ctx context.Context, input domain.ReactionInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input.RoundInput)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		if err := requireRoundReveal(ctx, q, roundID, access); err != nil {
			return err
		}
		if _, err := q.UpsertPrivateReaction(ctx, sqlc.UpsertPrivateReactionParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID, ParticipantID: participantID, Value: sqlc.PrivateReactionValue(input.Value)}); err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input.RoundInput)
}

func (s *Store) RemoveReaction(ctx context.Context, input domain.RoundInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		if err := requireRoundReveal(ctx, q, roundID, access); err != nil {
			return err
		}
		if err := q.DeletePrivateReaction(ctx, sqlc.DeletePrivateReactionParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID}); err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input)
}

func (s *Store) SetReply(ctx context.Context, input domain.ReplyInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input.RoundInput)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		if err := requireRoundReveal(ctx, q, roundID, access); err != nil {
			return err
		}
		if _, err := q.UpsertPrivateReply(ctx, sqlc.UpsertPrivateReplyParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID, ParticipantID: participantID, Body: input.Body}); err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input.RoundInput)
}

func (s *Store) RemoveReply(ctx context.Context, input domain.RoundInput) (domain.Round, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input)
	if err != nil {
		return domain.Round{}, domain.ErrNotFound
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		if err := requireRoundReveal(ctx, q, roundID, access); err != nil {
			return err
		}
		if err := q.DeletePrivateReply(ctx, sqlc.DeletePrivateReplyParams{RoundID: roundID, MembershipEraID: access.MembershipEraID, MembershipID: access.ActorMembershipID}); err != nil {
			return err
		}
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.Round{}, err
	}
	return s.GetRound(ctx, input)
}

func (s *Store) Progress(ctx context.Context, input domain.ProgressInput) (domain.View, error) {
	pairID, participantID, roundID, err := parseRoundIDs(input.RoundInput)
	if err != nil {
		return domain.View{}, domain.ErrNotFound
	}
	requestID, err := parseUUID(input.ClientRequestID)
	if err != nil {
		return domain.View{}, domain.ErrInvalidInput
	}
	var targetConversationID pgtype.UUID
	var changed bool
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		access, err := s.lockRoundAccess(ctx, q, pairID, participantID, roundID)
		if err != nil {
			return err
		}
		round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if round.ProgressionRequestID.Valid {
			if round.ProgressionRequestID != requestID {
				return domain.ErrProgressionConflict
			}
			targetConversationID = round.ProgressionConversationID
			return nil
		}
		conversation, err := q.GetPrivateConversation(ctx, sqlc.GetPrivateConversationParams{PairID: pairID, ConversationID: round.ConversationID, MembershipEraID: access.MembershipEraID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		if conversation.CreatedByParticipantID != participantID {
			return domain.ErrNotFound
		}
		if round.Status != sqlc.PrivateRoundStatusCompleted && round.Status != sqlc.PrivateRoundStatusRetired {
			return domain.ErrProgressionNotReady
		}
		if round.Status == sqlc.PrivateRoundStatusCompleted {
			answers, err := q.ListPrivateAnswers(ctx, sqlc.ListPrivateAnswersParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
			if err != nil {
				return err
			}
			reveals, err := q.ListPrivateRevealViews(ctx, sqlc.ListPrivateRevealViewsParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
			if err != nil {
				return err
			}
			if len(answers) != 2 || len(reveals) != 2 {
				return domain.ErrProgressionNotReady
			}
		}
		category := conversation.Category
		if input.Action == "something_else" {
			category = input.Category
			if category == conversation.Category || !domain.CategoryAllowed(string(access.RelationshipType), category) {
				return domain.ErrCategory
			}
		}
		if active, err := q.GetActivePrivateRoundForPair(ctx, sqlc.GetActivePrivateRoundForPairParams{PairID: pairID, MembershipEraID: access.MembershipEraID}); err == nil {
			if active.ID != roundID {
				return domain.ErrRoundOpen
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		targetConversationID = conversation.ID
		targetSelectionSeed := conversation.SelectionSeed
		waiting := false
		if input.Action == "something_else" {
			targetConversation, err := q.GetPrivateConversationByKey(ctx, sqlc.GetPrivateConversationByKeyParams{PairID: pairID, MembershipEraID: access.MembershipEraID, Category: category})
			if errors.Is(err, pgx.ErrNoRows) {
				targetConversation, err = q.CreatePrivateConversation(ctx, sqlc.CreatePrivateConversationParams{PairID: pairID, Category: category, CreatedByParticipantID: participantID, MembershipEraID: access.MembershipEraID})
				if errors.Is(err, pgx.ErrNoRows) {
					targetConversation, err = q.GetPrivateConversationByKey(ctx, sqlc.GetPrivateConversationByKeyParams{PairID: pairID, MembershipEraID: access.MembershipEraID, Category: category})
				}
			}
			if err != nil {
				return err
			}
			targetConversationID = targetConversation.ID
			targetSelectionSeed = targetConversation.SelectionSeed
			if targetConversation.CreatedByParticipantID != participantID {
				waiting = true
			}
		}
		var candidateID pgtype.UUID
		exhausted := false
		if !waiting {
			unresolved, unresolvedErr := q.GetCreatorUnresolvedPrivateCandidate(ctx, sqlc.GetCreatorUnresolvedPrivateCandidateParams{PairID: pairID, MembershipEraID: access.MembershipEraID, ParticipantID: participantID})
			if unresolvedErr == nil && unresolved.ConversationID != targetConversationID {
				return domain.ErrProgressionConflict
			}
			if unresolvedErr != nil && !errors.Is(unresolvedErr, pgx.ErrNoRows) {
				return unresolvedErr
			}
			if candidate, candidateErr := q.GetUnresolvedPrivateCandidate(ctx, targetConversationID); candidateErr == nil {
				candidateID = candidate.ID
			} else if !errors.Is(candidateErr, pgx.ErrNoRows) {
				return candidateErr
			} else {
				consumed, err := q.ListConsumedPrivateQuestionIDs(ctx, targetConversationID)
				if err != nil {
					return err
				}
				eligible, err := q.ListEligiblePrivateQuestions(ctx, sqlc.ListEligiblePrivateQuestionsParams{Category: category, RelationshipType: string(access.RelationshipType)})
				if err != nil {
					return err
				}
				completedCount, err := q.CountMutuallyCompletedPrivateRounds(ctx, targetConversationID)
				if err != nil {
					return err
				}
				selected, ok := choose(targetSelectionSeed, eligible, consumed, int(completedCount))
				if ok {
					candidate, err := q.CreatePrivateQuestionCandidate(ctx, sqlc.CreatePrivateQuestionCandidateParams{ConversationID: targetConversationID, QuestionID: selected.ID, QuestionRevisionID: selected.QuestionRevisionID})
					if err != nil {
						return err
					}
					candidateID = candidate.ID
				} else {
					exhausted = true
				}
			}
		}
		rows, err := q.SetPrivateRoundProgression(ctx, sqlc.SetPrivateRoundProgressionParams{ClientRequestID: requestID, Action: pgtype.Text{String: input.Action, Valid: true}, Category: pgtype.Text{String: category, Valid: true}, ConversationID: targetConversationID, CandidateID: candidateID, Exhausted: exhausted, Waiting: waiting, RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return err
		}
		if rows != 1 {
			return domain.ErrProgressionConflict
		}
		changed = true
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, realtimeEvent(input.PairID))
	})
	if err != nil {
		return domain.View{}, err
	}
	if changed || targetConversationID.Valid {
		return s.Read(ctx, domain.ReadInput{ParticipantID: input.ParticipantID, PairID: input.PairID, ConversationID: targetConversationID.String()})
	}
	return domain.View{}, domain.ErrNotFound
}

func requireRoundReveal(ctx context.Context, q *sqlc.Queries, roundID pgtype.UUID, access sqlc.GetPrivatePairAccessRow) error {
	round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: access.PairID, MembershipEraID: access.MembershipEraID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if round.Status == sqlc.PrivateRoundStatusRetired {
		return domain.ErrNotFound
	}
	answers, err := q.ListPrivateAnswers(ctx, sqlc.ListPrivateAnswersParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
	if err != nil {
		return err
	}
	if len(answers) != 2 {
		return domain.ErrNotFound
	}
	reveals, err := q.ListPrivateRevealViews(ctx, sqlc.ListPrivateRevealViewsParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
	if err != nil {
		return err
	}
	for _, reveal := range reveals {
		if reveal.MembershipID == access.ActorMembershipID {
			return nil
		}
	}
	return domain.ErrNotFound
}

func parseRoundIDs(input domain.RoundInput) (pgtype.UUID, pgtype.UUID, pgtype.UUID, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, pgtype.UUID{}, err
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, pgtype.UUID{}, err
	}
	roundID, err := parseUUID(input.RoundID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, pgtype.UUID{}, err
	}
	return pairID, participantID, roundID, nil
}

func (s *Store) lockRoundAccess(ctx context.Context, q *sqlc.Queries, pairID, participantID, roundID pgtype.UUID) (sqlc.GetPrivatePairAccessRow, error) {
	if _, err := q.LockPrivatePair(ctx, pairID); errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, domain.ErrNotFound
	} else if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, err
	}
	access, err := q.GetPrivatePairAccess(ctx, sqlc.GetPrivatePairAccessParams{PairID: pairID, ParticipantID: participantID})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, domain.ErrNotFound
	}
	if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, err
	}
	// Validate the round's pair/era/member relationship inside the same transaction.
	if _, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID}); errors.Is(err, pgx.ErrNoRows) {
		return sqlc.GetPrivatePairAccessRow{}, domain.ErrNotFound
	} else if err != nil {
		return sqlc.GetPrivatePairAccessRow{}, err
	}
	return access, nil
}

func (s *Store) roundProjection(ctx context.Context, q *sqlc.Queries, input domain.RoundInput, roundID, pairID pgtype.UUID, access sqlc.GetPrivatePairAccessRow) (domain.Round, error) {
	round, err := q.GetPrivateRoundForParticipant(ctx, sqlc.GetPrivateRoundForParticipantParams{RoundID: roundID, PairID: pairID, MembershipEraID: access.MembershipEraID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Round{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Round{}, err
	}
	answers, err := q.ListPrivateAnswers(ctx, sqlc.ListPrivateAnswersParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
	if err != nil {
		return domain.Round{}, err
	}
	reveals, err := q.ListPrivateRevealViews(ctx, sqlc.ListPrivateRevealViewsParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
	if err != nil {
		return domain.Round{}, err
	}
	result := domain.Round{ID: round.ID.String(), PairID: round.PairID.String(), ConversationID: round.ConversationID.String(), MembershipEraID: round.MembershipEraID.String(), CandidateID: round.CandidateID.String(), QuestionID: round.QuestionID.String(), QuestionRevisionID: round.QuestionRevisionID.String(), RoundNumber: round.RoundNumber, AskedAt: timestampString(round.AskedAt), Text: round.Text, Category: round.Category, Intensity: round.Intensity}
	var ownAnswer *sqlc.PrivateAnswer
	for i := range answers {
		if answers[i].MembershipID == access.ActorMembershipID {
			ownAnswer = &answers[i]
			break
		}
	}
	if ownAnswer != nil {
		value := ownAnswer.Body
		result.YourAnswer = &value
	}
	result.HasOtherAnswer = len(answers) > 0 && ownAnswer == nil || len(answers) == 2
	viewerRevealed, otherRevealed := false, false
	for _, view := range reveals {
		if view.MembershipID == access.ActorMembershipID {
			viewerRevealed = true
		} else if view.MembershipID == access.OtherMembershipID {
			otherRevealed = true
		}
	}
	if viewerRevealed && len(reveals) > 0 {
		for _, view := range reveals {
			if view.MembershipID == access.OtherMembershipID {
				result.OtherRevealViewedAt = timestampString(view.ViewedAt)
			} else if view.MembershipID == access.ActorMembershipID {
				result.RevealViewedAt = timestampString(view.ViewedAt)
			}
		}
	}
	result.OtherRevealViewed = otherRevealed
	if round.Status == sqlc.PrivateRoundStatusRetired {
		result.State = "DECLINED"
	} else if len(answers) < 2 {
		if ownAnswer == nil {
			result.State = "YOUR_TURN"
		} else {
			result.State = "WAITING"
		}
	} else if viewerRevealed {
		result.State = "REVEAL_VIEWED"
	} else {
		result.State = "REVEAL_READY"
	}
	conversation, err := q.GetPrivateConversation(ctx, sqlc.GetPrivateConversationParams{PairID: pairID, ConversationID: round.ConversationID, MembershipEraID: access.MembershipEraID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.Round{}, err
	}
	result.CanContinue = !errors.Is(err, pgx.ErrNoRows) && conversation.CreatedByParticipantID == access.ActorParticipantID && (round.Status == sqlc.PrivateRoundStatusRetired || (round.Status == sqlc.PrivateRoundStatusCompleted && len(answers) == 2 && viewerRevealed && otherRevealed))
	if viewerRevealed && len(answers) == 2 {
		result.Answers = make([]domain.Answer, 0, len(answers))
		for _, answer := range answers {
			result.Answers = append(result.Answers, domain.Answer{ParticipantID: answer.ParticipantID.String(), MembershipID: answer.MembershipID.String(), Body: answer.Body, CreatedAt: timestampString(answer.CreatedAt), IsOwner: answer.MembershipID == access.ActorMembershipID})
		}
		reactions, err := q.ListPrivateReactions(ctx, sqlc.ListPrivateReactionsParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return domain.Round{}, err
		}
		result.Reactions = make([]domain.Reaction, 0, len(reactions))
		for _, reaction := range reactions {
			result.Reactions = append(result.Reactions, domain.Reaction{ParticipantID: reaction.ParticipantID.String(), DisplayName: reaction.DisplayName, Value: string(reaction.Value), IsOwner: reaction.MembershipID == access.ActorMembershipID})
		}
		replies, err := q.ListPrivateReplies(ctx, sqlc.ListPrivateRepliesParams{RoundID: roundID, MembershipEraID: access.MembershipEraID})
		if err != nil {
			return domain.Round{}, err
		}
		result.Replies = make([]domain.Reply, 0, len(replies))
		for _, reply := range replies {
			result.Replies = append(result.Replies, domain.Reply{ParticipantID: reply.ParticipantID.String(), DisplayName: reply.DisplayName, Body: reply.Body, IsOwner: reply.MembershipID == access.ActorMembershipID})
		}
	}
	return result, nil
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

func choose(seed string, questions []sqlc.ListEligiblePrivateQuestionsRow, consumed []pgtype.UUID, completedRoundCount int) (eligibleQuestion, bool) {
	used := make(map[string]struct{}, len(consumed))
	for _, id := range consumed {
		used[id.String()] = struct{}{}
	}
	preferred := domain.PreferredIntensities(completedRoundCount)
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

func availablePrivateCategories(relationshipType string) []string {
	categories := []string{"fun", "deep", "memories"}
	if relationshipType == "partner" {
		return append(categories, "relationship")
	}
	if relationshipType == "friend" {
		return append(categories, "friendship")
	}
	return categories
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
