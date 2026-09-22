// Package private owns the Private Conversation entry contract. Round and
// answer behavior intentionally remains outside this package until P-02.
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
)

type CandidateQuestion struct {
	ID, RevisionID, Text, Category, Intensity string
}

type Candidate struct {
	ID       string
	Question CandidateQuestion
}

type View struct {
	PairID, ConversationID, Category         string
	State                                    string
	CreatorParticipantID, CreatorDisplayName string
	Candidate                                *Candidate
}

type StartInput struct {
	ParticipantID, PairID, Category string
}

type ReadInput struct {
	ParticipantID, PairID, ConversationID string
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
