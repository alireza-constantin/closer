// Package together owns the bounded, shared-device Together session.
package together

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

var (
	ErrInvalidInput        = errors.New("Together input is invalid")
	ErrPairNotFound        = errors.New("Pair not found")
	ErrSessionNotFound     = errors.New("Together session not found")
	ErrSessionEnded        = errors.New("Together session ended")
	ErrSessionExhausted    = errors.New("Together session exhausted")
	ErrQuestionUnavailable = errors.New("Question unavailable")
	ErrActionInvalid       = errors.New("Together action is invalid")
	ErrParticipantRequired = errors.New("Participant is required")
)

type Category string

const (
	CategoryFun          Category = "fun"
	CategoryDeep         Category = "deep"
	CategoryMemories     Category = "memories"
	CategoryRelationship Category = "relationship"
	CategoryFriendship   Category = "friendship"
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type StartInput struct {
	ParticipantID   string
	PairID          string
	Category        string
	ClientRequestID string
	SelectionSeed   string
}

type StartResult struct {
	SessionID          string `json:"sessionId"`
	QuestionID         string `json:"questionId"`
	QuestionRevisionID string `json:"questionRevisionId"`
}

type PlaybackInput struct {
	ParticipantID string
	PairID        string
	SessionID     string
}

type Question struct {
	QuestionID         string `json:"questionId"`
	QuestionRevisionID string `json:"questionRevisionId"`
	Text               string `json:"text"`
	Intensity          string `json:"intensity,omitempty"`
	Position           int32  `json:"position"`
	Liked              bool   `json:"liked"`
}

type Playback struct {
	ID                       string        `json:"id"`
	PairID                   string        `json:"pairId"`
	RelationshipType         string        `json:"relationshipType"`
	Category                 string        `json:"category"`
	StartedByParticipantID   string        `json:"startedByParticipantId"`
	StartedAt                string        `json:"startedAt"`
	EndedAt                  *string       `json:"endedAt"`
	Exhausted                bool          `json:"exhausted"`
	CompletedNextTransitions int32         `json:"completedNextTransitions"`
	Question                 *Question     `json:"question"`
	Pages                    QuestionPools `json:"pages"`
}

type PageInput struct {
	PlaybackInput
	Band   string
	Cursor string
}

type QuestionPage struct {
	Items      []Question `json:"items"`
	NextCursor *string    `json:"nextCursor"`
	HasMore    bool       `json:"hasMore"`
}

type QuestionPools struct {
	Light  QuestionPage `json:"light"`
	Medium QuestionPage `json:"medium"`
	Deep   QuestionPage `json:"deep"`
}

type AdvanceInput struct {
	PlaybackInput
	Action                 string
	ClientRequestID        string
	CurrentQuestionID      string
	NextQuestionID         string
	NextQuestionRevisionID string
}

type AdvanceResult struct {
	Kind                     string `json:"kind"`
	SessionID                string `json:"sessionId"`
	QuestionID               string `json:"questionId,omitempty"`
	QuestionRevisionID       string `json:"questionRevisionId,omitempty"`
	Position                 int32  `json:"position,omitempty"`
	CompletedNextTransitions int32  `json:"completedNextTransitions"`
}

type LikeInput struct {
	PlaybackInput
	Liked             bool
	CurrentQuestionID string
}

type Store interface {
	Start(context.Context, StartInput) (StartResult, error)
	Playback(context.Context, PlaybackInput) (Playback, error)
	Page(context.Context, PageInput) (QuestionPage, error)
	Advance(context.Context, AdvanceInput) (AdvanceResult, error)
	Like(context.Context, LikeInput) (Playback, error)
	End(context.Context, PlaybackInput) (Playback, error)
}

type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }

func (s *Service) Start(ctx context.Context, input StartInput) (StartResult, error) {
	if input.ParticipantID == "" || input.PairID == "" || !validCategory(input.Category, "") || !optionalUUID(input.ClientRequestID) || strings.TrimSpace(input.SelectionSeed) == "" && input.SelectionSeed != "" {
		return StartResult{}, ErrInvalidInput
	}
	return s.store.Start(ctx, input)
}

func (s *Service) Playback(ctx context.Context, input PlaybackInput) (Playback, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.SessionID == "" {
		return Playback{}, ErrInvalidInput
	}
	return s.store.Playback(ctx, input)
}

func (s *Service) Page(ctx context.Context, input PageInput) (QuestionPage, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.SessionID == "" || !validBand(input.Band) {
		return QuestionPage{}, ErrInvalidInput
	}
	return s.store.Page(ctx, input)
}

func (s *Service) Advance(ctx context.Context, input AdvanceInput) (AdvanceResult, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.SessionID == "" || (input.Action != "next" && input.Action != "skip") || !optionalUUID(input.ClientRequestID) || (input.NextQuestionID == "") != (input.NextQuestionRevisionID == "") {
		return AdvanceResult{}, ErrInvalidInput
	}
	return s.store.Advance(ctx, input)
}

func (s *Service) Like(ctx context.Context, input LikeInput) (Playback, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.SessionID == "" {
		return Playback{}, ErrInvalidInput
	}
	return s.store.Like(ctx, input)
}

func (s *Service) End(ctx context.Context, input PlaybackInput) (Playback, error) {
	if input.ParticipantID == "" || input.PairID == "" || input.SessionID == "" {
		return Playback{}, ErrInvalidInput
	}
	return s.store.End(ctx, input)
}

func validCategory(value, relationship string) bool {
	switch Category(value) {
	case CategoryFun, CategoryDeep, CategoryMemories:
		return true
	case CategoryRelationship:
		return relationship == "" || relationship == "partner"
	case CategoryFriendship:
		return relationship == "" || relationship == "friend"
	default:
		return false
	}
}

func validBand(value string) bool { return value == "light" || value == "medium" || value == "deep" }

func optionalUUID(value string) bool { return value == "" || uuidPattern.MatchString(value) }
