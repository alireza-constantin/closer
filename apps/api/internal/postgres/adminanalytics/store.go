package adminanalytics

import (
	"context"
	"errors"

	domain "github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct{ pool *postgres.Pool }

func NewStore(pool *postgres.Pool) *Store { return &Store{pool: pool} }

func (s *Store) SelectRevision(ctx context.Context, questionID string, scope domain.Scope, revisionID string) (domain.RevisionSelection, error) {
	qid, err := parseUUID(questionID)
	if err != nil {
		return domain.RevisionSelection{}, domain.ErrNotFound
	}
	selection := domain.RevisionSelection{}
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		row, err := q.GetAdminAnalyticsQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		if err != nil {
			return err
		}
		selection.CurrentRevisionID = row.CurrentRevisionID.String()
		switch scope {
		case domain.ScopeCurrent:
			selection.SelectedRevisionID = row.CurrentRevisionID.String()
			selection.SelectedRevisionNumber = row.RevisionNumber
		case domain.ScopeRevision:
			rid, err := parseUUID(revisionID)
			if err != nil {
				return domain.ErrNotFound
			}
			revision, err := q.GetAdminAnalyticsRevision(ctx, sqlc.GetAdminAnalyticsRevisionParams{QuestionID: qid, ID: rid})
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			if err != nil {
				return err
			}
			selection.SelectedRevisionID = revision.ID.String()
			selection.SelectedRevisionNumber = revision.RevisionNumber
		case domain.ScopeAll:
			// An empty selected revision means the aggregate explicitly spans history.
		default:
			return domain.ErrNotFound
		}
		return nil
	})
	return selection, err
}

func (s *Store) PrivateAggregate(ctx context.Context, questionID, revisionID string, scope domain.Scope) (*domain.PrivateAggregate, error) {
	qid, err := parseUUID(questionID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var rid pgtype.UUID
	if scope != domain.ScopeAll {
		rid, err = parseUUID(revisionID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var row sqlc.GetAdminPrivateQuestionAnalyticsRow
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var queryErr error
		row, queryErr = sqlc.New(db).GetAdminPrivateQuestionAnalytics(ctx, sqlc.GetAdminPrivateQuestionAnalyticsParams{QuestionID: qid, Column2: rid, MinDistinctPairs: domain.MinimumDistinctPairs})
		return queryErr
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &domain.PrivateAggregate{ValidOffers: row.ValidOffers, Decisions: row.Decisions, Asked: row.Asked, Skipped: row.Skipped, LikedDecisions: row.LikedDecisions}, nil
}

func (s *Store) TogetherAggregate(ctx context.Context, questionID, revisionID string, scope domain.Scope) (*domain.TogetherAggregate, error) {
	qid, err := parseUUID(questionID)
	if err != nil {
		return nil, domain.ErrNotFound
	}
	var rid pgtype.UUID
	if scope != domain.ScopeAll {
		rid, err = parseUUID(revisionID)
		if err != nil {
			return nil, domain.ErrNotFound
		}
	}
	var row sqlc.GetAdminTogetherQuestionAnalyticsRow
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var queryErr error
		row, queryErr = sqlc.New(db).GetAdminTogetherQuestionAnalytics(ctx, sqlc.GetAdminTogetherQuestionAnalyticsParams{QuestionID: qid, Column2: rid, MinDistinctPairs: domain.MinimumDistinctPairs})
		return queryErr
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &domain.TogetherAggregate{Shown: row.Shown, Decisions: row.Decisions, Continued: row.Continued, Skipped: row.Skipped, LikedDecisions: row.LikedDecisions}, nil
}

func (s *Store) Coverage(ctx context.Context) ([]domain.CoverageLane, error) {
	categories := []string{"fun", "deep", "memories", "relationship", "friendship"}
	types := []string{"partner", "friend"}
	modes := []string{"together", "private"}
	lanes := make([]domain.CoverageLane, 0, 20)
	for _, relationshipType := range types {
		for _, mode := range modes {
			var rows []sqlc.GetAdminQuestionCoverageRow
			err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
				var queryErr error
				rows, queryErr = sqlc.New(db).GetAdminQuestionCoverage(ctx, sqlc.GetAdminQuestionCoverageParams{RelationshipType: relationshipType, Mode: mode})
				return queryErr
			})
			if err != nil {
				return nil, err
			}
			counts := make(map[string]sqlc.GetAdminQuestionCoverageRow, len(rows))
			for _, row := range rows {
				counts[row.Category] = row
			}
			for _, category := range categories {
				row := counts[category]
				lanes = append(lanes, domain.CoverageLane{Category: category, RelationshipType: relationshipType, Mode: mode, Eligible: row.Eligible, Light: row.Light, Medium: row.Medium, Deep: row.Deep})
			}
		}
	}
	return lanes, nil
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	err := id.Scan(value)
	return id, err
}
