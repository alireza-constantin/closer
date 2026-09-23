// Package adminanalytics owns the read-only aggregate projections used by Admin.
package adminanalytics

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("question or revision not found")

const MinimumDistinctPairs int64 = 5

type Scope string

const (
	ScopeCurrent  Scope = "current"
	ScopeRevision Scope = "revision"
	ScopeAll      Scope = "all"
)

type RevisionSelection struct {
	CurrentRevisionID      string
	SelectedRevisionID     string
	SelectedRevisionNumber int32
}

type PrivateAggregate struct {
	ValidOffers    int64
	Decisions      int64
	Asked          int64
	Skipped        int64
	LikedDecisions int64
}

type TogetherAggregate struct {
	Shown          int64
	Decisions      int64
	Continued      int64
	Skipped        int64
	LikedDecisions int64
}

type CoverageLane struct {
	Category         string
	RelationshipType string
	Mode             string
	Eligible         int64
	Light            int64
	Medium           int64
	Deep             int64
}

// Repository methods return performance aggregates only after the SQL privacy
// threshold has passed. Suppressed buckets are represented by a missing row.
type Repository interface {
	SelectRevision(context.Context, string, Scope, string) (RevisionSelection, error)
	PrivateAggregate(context.Context, string, string, Scope) (*PrivateAggregate, error)
	TogetherAggregate(context.Context, string, string, Scope) (*TogetherAggregate, error)
	Coverage(context.Context) ([]CoverageLane, error)
}

type Service struct{ repository Repository }

func NewService(repository Repository) *Service { return &Service{repository: repository} }

type QuestionAnalytics struct {
	QuestionID             string
	RevisionScope          Scope
	SelectedRevisionID     string
	SelectedRevisionNumber int32
	Private                *PrivateAggregate
	Together               *TogetherAggregate
}

func (s *Service) QuestionAnalytics(ctx context.Context, questionID string, scope Scope, revisionID string) (QuestionAnalytics, error) {
	selection, err := s.repository.SelectRevision(ctx, questionID, scope, revisionID)
	if err != nil {
		return QuestionAnalytics{}, err
	}
	private, err := s.repository.PrivateAggregate(ctx, questionID, selection.SelectedRevisionID, scope)
	if err != nil {
		return QuestionAnalytics{}, err
	}
	together, err := s.repository.TogetherAggregate(ctx, questionID, selection.SelectedRevisionID, scope)
	if err != nil {
		return QuestionAnalytics{}, err
	}
	return QuestionAnalytics{QuestionID: questionID, RevisionScope: scope, SelectedRevisionID: selection.SelectedRevisionID, SelectedRevisionNumber: selection.SelectedRevisionNumber, Private: private, Together: together}, nil
}

func (s *Service) Coverage(ctx context.Context) ([]CoverageLane, error) {
	return s.repository.Coverage(ctx)
}

func CoverageHealth(count int64) string {
	switch {
	case count <= 5:
		return "critical"
	case count <= 11:
		return "low"
	default:
		return "healthy"
	}
}
