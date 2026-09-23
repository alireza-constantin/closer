// Package private owns the Private Conversation and Round command contracts.
package private

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"
)

var (
	ErrNotFound            = errors.New("private conversation not found")
	ErrPairNotReady        = errors.New("pair is not ready for Private")
	ErrCategory            = errors.New("private category is invalid")
	ErrCandidate           = errors.New("private candidate is unavailable")
	ErrRoundOpen           = errors.New("a Private round is already open")
	ErrInvalidInput        = errors.New("private command input is invalid")
	ErrAnswerInvalid       = errors.New("private answer is invalid")
	ErrAnswerImmutable     = errors.New("private answer is immutable")
	ErrQuestionUnavailable = errors.New("private question is unavailable")
	ErrRevealNotReady      = errors.New("private reveal is not ready")
	ErrReactionInvalid     = errors.New("private reaction is invalid")
	ErrReplyInvalid        = errors.New("private reply is invalid")
	ErrProgressionNotReady = errors.New("private progression is not ready")
	ErrProgressionConflict = errors.New("private progression already started")
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
	YourAnswer                                  *string
	HasOtherAnswer                              bool
	RevealViewedAt, OtherRevealViewedAt         string
	OtherRevealViewed                           bool
	CanContinue                                 bool
	Answers                                     []Answer
	Reactions                                   []Reaction
	Replies                                     []Reply
}

type Answer struct {
	ParticipantID, MembershipID, Body, CreatedAt string
	IsOwner                                      bool
}
type Reaction struct {
	ParticipantID, DisplayName, Value string
	IsOwner                           bool
}
type Reply struct {
	ParticipantID, DisplayName, Body string
	IsOwner                          bool
}

type View struct {
	PairID, ConversationID, Category         string
	State                                    string
	AvailableCategories                      []string
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

type RoundInput struct{ ParticipantID, PairID, RoundID string }
type AnswerInput struct {
	RoundInput
	Body string
}
type ReactionInput struct {
	RoundInput
	Value string
}
type ReplyInput struct {
	RoundInput
	Body string
}
type ProgressInput struct {
	RoundInput
	ClientRequestID, Action, Category string
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
	GetRound(context.Context, RoundInput) (Round, error)
	Answer(context.Context, AnswerInput) (Round, error)
	Decline(context.Context, RoundInput) (Round, error)
	Reveal(context.Context, RoundInput) (Round, error)
	SetReaction(context.Context, ReactionInput) (Round, error)
	RemoveReaction(context.Context, RoundInput) (Round, error)
	SetReply(context.Context, ReplyInput) (Round, error)
	RemoveReply(context.Context, RoundInput) (Round, error)
	Progress(context.Context, ProgressInput) (View, error)
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

func (s *Service) GetRound(ctx context.Context, input RoundInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.GetRound(ctx, input)
}
func (s *Service) Answer(ctx context.Context, input AnswerInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.Answer(ctx, input)
}
func (s *Service) Decline(ctx context.Context, input RoundInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.Decline(ctx, input)
}
func (s *Service) Reveal(ctx context.Context, input RoundInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.Reveal(ctx, input)
}

func (s *Service) SetReaction(ctx context.Context, input ReactionInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	if !validReaction(input.Value) {
		return Round{}, ErrReactionInvalid
	}
	return s.repository.SetReaction(ctx, input)
}
func (s *Service) RemoveReaction(ctx context.Context, input RoundInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.RemoveReaction(ctx, input)
}
func (s *Service) SetReply(ctx context.Context, input ReplyInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	body := strings.TrimSpace(input.Body)
	if body == "" || utf8.RuneCountInString(body) > 500 {
		return Round{}, ErrReplyInvalid
	}
	input.Body = body
	return s.repository.SetReply(ctx, input)
}
func (s *Service) RemoveReply(ctx context.Context, input RoundInput) (Round, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return Round{}, ErrNotFound
	}
	return s.repository.RemoveReply(ctx, input)
}

func (s *Service) Progress(ctx context.Context, input ProgressInput) (View, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.RoundID == "" {
		return View{}, ErrNotFound
	}
	if input.ClientRequestID == "" || (input.Action != "ask_another" && input.Action != "something_else") {
		return View{}, ErrInvalidInput
	}
	if input.Action == "something_else" && !validCategory(input.Category) {
		return View{}, ErrCategory
	}
	input.Category = strings.TrimSpace(input.Category)
	return s.repository.Progress(ctx, input)
}

func validReaction(value string) bool {
	switch value {
	case "heart", "laugh", "tender", "surprised":
		return true
	default:
		return false
	}
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
