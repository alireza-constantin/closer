// Package question owns the revisioned editorial Question lifecycle.
package question

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrNotFound         = errors.New("question not found")
	ErrConflict         = errors.New("question changed since it was loaded")
	ErrInvalidInput     = errors.New("question input is invalid")
	ErrCurrentWithdrawn = errors.New("current question revision is withdrawn")
	ErrWithdrawalReason = errors.New("withdrawal reason is required")
	ErrRevisionNotFound = errors.New("question revision not found")
)

type RevisionFields struct{ Text, Category, RelationshipFit, ModeFit, Intensity string }
type Revision struct {
	ID, QuestionID string
	RevisionFields
	RevisionNumber int32
	Withdrawn      bool
}
type Question struct {
	ID, CurrentRevisionID string
	IsActive              bool
	Current               Revision
}
type ListFilter struct {
	Search, Category, Intensity, RelationshipFit, ModeFit string
	Limit, Offset                                         int32
}

// CandidateInvalidator is the future Private-domain port for withdrawal. Q-01
// deliberately does not implement candidate persistence; the Private lane must
// provide this port and invoke it in the same transaction as withdrawal.
type CandidateInvalidator interface {
	InvalidateUnresolvedCandidates(context.Context, string) error
}

type DeferredCandidateInvalidator struct{}

func (DeferredCandidateInvalidator) InvalidateUnresolvedCandidates(context.Context, string) error {
	return nil
}

type Repository interface {
	Create(context.Context, RevisionFields, string) (Question, error)
	Edit(context.Context, string, RevisionFields, string, string) (Question, error)
	Restore(context.Context, string, string, string, string) (Question, error)
	SetActivity(context.Context, string, string, string) (Question, error)
	Withdraw(context.Context, string, string, string, string) (Revision, error)
	Get(context.Context, string) (Question, error)
	List(context.Context, ListFilter) ([]Question, error)
	ListRevisions(context.Context, string) ([]Revision, error)
}

type Service struct{ repository Repository }

func NewService(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) Create(ctx context.Context, fields RevisionFields, adminID string) (Question, error) {
	if err := validate(fields); err != nil {
		return Question{}, err
	}
	return s.repository.Create(ctx, normalized(fields), adminID)
}
func (s *Service) Edit(ctx context.Context, id string, fields RevisionFields, expected, adminID string) (Question, error) {
	if err := validate(fields); err != nil {
		return Question{}, err
	}
	if expected == "" {
		return Question{}, ErrConflict
	}
	return s.repository.Edit(ctx, id, normalized(fields), expected, adminID)
}
func (s *Service) Restore(ctx context.Context, id, source, expected, adminID string) (Question, error) {
	if source == "" || expected == "" {
		return Question{}, ErrInvalidInput
	}
	return s.repository.Restore(ctx, id, source, expected, adminID)
}
func (s *Service) SetActivity(ctx context.Context, id, action, adminID string) (Question, error) {
	if action != "activate" && action != "reactivate" && action != "deactivate" {
		return Question{}, ErrInvalidInput
	}
	return s.repository.SetActivity(ctx, id, action, adminID)
}
func (s *Service) Withdraw(ctx context.Context, id, revision, reason, adminID string) (Revision, error) {
	if strings.TrimSpace(reason) == "" {
		return Revision{}, ErrWithdrawalReason
	}
	return s.repository.Withdraw(ctx, id, revision, strings.TrimSpace(reason), adminID)
}
func (s *Service) Get(ctx context.Context, id string) (Question, error) {
	return s.repository.Get(ctx, id)
}
func (s *Service) List(ctx context.Context, filter ListFilter) ([]Question, error) {
	return s.repository.List(ctx, filter)
}
func (s *Service) ListRevisions(ctx context.Context, id string) ([]Revision, error) {
	return s.repository.ListRevisions(ctx, id)
}

func validate(value RevisionFields) error {
	if strings.TrimSpace(value.Text) == "" || value.Category == "" || value.RelationshipFit == "" || value.ModeFit == "" || value.Intensity == "" {
		return ErrInvalidInput
	}
	valid := func(value string, allowed ...string) bool {
		for _, item := range allowed {
			if value == item {
				return true
			}
		}
		return false
	}
	if !valid(value.Category, "fun", "deep", "memories", "relationship", "friendship") || !valid(value.RelationshipFit, "both", "partner", "friend") || !valid(value.ModeFit, "both", "together", "private") || !valid(value.Intensity, "light", "medium", "deep") {
		return ErrInvalidInput
	}
	if value.Category == "relationship" && value.RelationshipFit != "partner" || value.Category == "friendship" && value.RelationshipFit != "friend" {
		return ErrInvalidInput
	}
	return nil
}
func normalized(value RevisionFields) RevisionFields {
	value.Text = strings.Join(strings.Fields(value.Text), " ")
	return value
}
