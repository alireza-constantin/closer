// Package private owns the Private Conversation and P-02 candidate command
// contracts. Answer behavior remains outside this package until P-03.
package private

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrNotFound     = errors.New("private conversation not found")
	ErrPairNotReady = errors.New("pair is not ready for Private")
	ErrCategory     = errors.New("private category is invalid")
	ErrCandidate    = errors.New("private candidate is unavailable")
	ErrRoundOpen    = errors.New("a Private round is already open")
	ErrInvalidInput = errors.New("private command input is invalid")
)

type CandidateQuestion struct {
	ID, RevisionID, Text, Category, Intensity string
}

type Candidate struct {
	ID       string
	Liked    bool
	Question CandidateQuestion
}

type Round struct {
	ID, PairID, ConversationID, MembershipEraID string
	CandidateID, QuestionID, QuestionRevisionID string
	RoundNumber                                 int32
	State, AskedAt, Text, Category, Intensity   string
}

type View struct {
	PairID, ConversationID, Category         string
	State                                    string
	CreatorParticipantID, CreatorDisplayName string
	Candidate                                *Candidate
	Round                                    *Round
}

type StartInput struct {
	ParticipantID, PairID, Category string
}

type ReadInput struct {
	ParticipantID, PairID, ConversationID string
}

type AskInput struct {
	ParticipantID, PairID, ConversationID, CandidateID, ClientRequestID string
}

type SkipInput struct {
	ParticipantID, PairID, ConversationID, CandidateID, ClientRequestID string
}

type LikeInput struct {
	ParticipantID, PairID, ConversationID, CandidateID string
	Liked                                              bool
}

type Question struct {
	ID, RevisionID, Text, Category, Intensity string
}

type Access struct {
	PairID, RelationshipType, ActorParticipantID, OtherParticipantID, MembershipEraID string
}

type Conversation struct {
	ID, PairID, Category, CreatedByParticipantID, MembershipEraID, SelectionSeed string
}

type Repository interface {
	StartOrResume(context.Context, StartInput) (View, error)
	Read(context.Context, ReadInput) (View, error)
	Ask(context.Context, AskInput) (Round, error)
	Skip(context.Context, SkipInput) (View, error)
	Like(context.Context, LikeInput) (bool, error)
}

type Service struct{ repository Repository }

func NewService(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) StartOrResume(ctx context.Context, input StartInput) (View, error) {
	if input.ParticipantID == "" || input.PairID == "" {
		return View{}, ErrNotFound
	}
	if !validCategory(input.Category) {
		return View{}, ErrCategory
	}
	return s.repository.StartOrResume(ctx, input)
}

func (s *Service) Read(ctx context.Context, input ReadInput) (View, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.ConversationID == "" {
		return View{}, ErrNotFound
	}
	return s.repository.Read(ctx, input)
}

func (s *Service) Ask(ctx context.Context, input AskInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.ConversationID == "" || input.CandidateID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.Ask(ctx, input)
}

func (s *Service) Skip(ctx context.Context, input SkipInput) (View, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.ConversationID == "" || input.CandidateID == "" || input.ClientRequestID == "" {
		return View{}, ErrInvalidInput
	}
	return s.repository.Skip(ctx, input)
}

func (s *Service) Like(ctx context.Context, input LikeInput) (bool, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.ConversationID == "" || input.CandidateID == "" {
		return false, ErrNotFound
	}
	return s.repository.Like(ctx, input)
}

func validCategory(category string) bool {
	switch strings.TrimSpace(category) {
	case "fun", "deep", "memories", "relationship", "friendship":
		return true
	default:
		return false
	}
}

func CategoryAllowed(relationshipType, category string) bool {
	if category != "relationship" && category != "friendship" {
		return true
	}
	return (relationshipType == "partner" && category == "relationship") ||
		(relationshipType == "friend" && category == "friendship")
}

// PreferredIntensities is the P-01 foundation's deterministic soft ramp. The
// completed-round count is accepted now so P-02 can add progress without
// changing candidate identity or ordering semantics.
func PreferredIntensities(completedRoundCount int) []string {
	if completedRoundCount >= 4 {
		return []string{"deep", "medium", "light"}
	}
	if completedRoundCount >= 2 {
		return []string{"medium", "light", "deep"}
	}
	return []string{"light", "medium", "deep"}
}
