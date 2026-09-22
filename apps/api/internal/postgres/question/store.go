package question

import (
	"context"
	"errors"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct {
	pool        *postgres.Pool
	invalidator question.CandidateInvalidator
}

func NewStore(pool *postgres.Pool, invalidators ...question.CandidateInvalidator) *Store {
	var invalidator question.CandidateInvalidator = question.DeferredCandidateInvalidator{}
	if len(invalidators) > 0 && invalidators[0] != nil {
		invalidator = invalidators[0]
	}
	return &Store{pool: pool, invalidator: invalidator}
}

type withdrawalExecutor struct{ db postgres.QueryDB }

func (e withdrawalExecutor) Exec(ctx context.Context, query string, args ...any) error {
	_, err := e.db.Exec(ctx, query, args...)
	return err
}

func (s *Store) Create(ctx context.Context, fields question.RevisionFields, adminID string) (question.Question, error) {
	var result question.Question
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		admin, err := uuid(adminID)
		if err != nil {
			return question.ErrInvalidInput
		}
		created, err := q.CreateQuestion(ctx)
		if err != nil {
			return err
		}
		revision, err := q.CreateQuestionRevision(ctx, sqlc.CreateQuestionRevisionParams{QuestionID: created.ID, Text: fields.Text, Category: fields.Category, RelationshipFit: fields.RelationshipFit, ModeFit: fields.ModeFit, Intensity: fields.Intensity, RevisionNumber: 1, CreatedByAdminUserID: admin})
		if err != nil {
			return err
		}
		if err := q.SetCurrentQuestionRevision(ctx, sqlc.SetCurrentQuestionRevisionParams{ID: created.ID, CurrentRevisionID: revision.ID}); err != nil {
			return err
		}
		result, err = readQuestion(ctx, q, created.ID)
		return err
	})
	return result, err
}

func (s *Store) Edit(ctx context.Context, id string, fields question.RevisionFields, expected, adminID string) (question.Question, error) {
	return s.newRevision(ctx, id, fields, expected, adminID, "")
}

func (s *Store) Restore(ctx context.Context, id, source, expected, adminID string) (question.Question, error) {
	var result question.Question
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		expectedID, err := uuid(expected)
		if err != nil {
			return question.ErrConflict
		}
		admin, err := uuid(adminID)
		if err != nil {
			return question.ErrInvalidInput
		}
		locked, err := q.LockQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrNotFound
		}
		if err != nil {
			return err
		}
		if locked.CurrentRevisionID != expectedID {
			return question.ErrConflict
		}
		sourceID, err := uuid(source)
		if err != nil {
			return question.ErrRevisionNotFound
		}
		old, err := q.GetQuestionRevision(ctx, sqlc.GetQuestionRevisionParams{ID: sourceID, QuestionID: qid})
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrRevisionNotFound
		}
		if err != nil {
			return err
		}
		next, err := q.NextQuestionRevisionNumber(ctx, qid)
		if err != nil {
			return err
		}
		created, err := q.CreateQuestionRevision(ctx, sqlc.CreateQuestionRevisionParams{QuestionID: qid, Text: old.Text, Category: old.Category, RelationshipFit: old.RelationshipFit, ModeFit: old.ModeFit, Intensity: old.Intensity, RevisionNumber: next, CreatedByAdminUserID: admin})
		if err != nil {
			return err
		}
		if err := q.SetCurrentQuestionRevision(ctx, sqlc.SetCurrentQuestionRevisionParams{ID: qid, CurrentRevisionID: created.ID}); err != nil {
			return err
		}
		result, err = readQuestion(ctx, q, qid)
		return err
	})
	return result, err
}

func (s *Store) newRevision(ctx context.Context, id string, fields question.RevisionFields, expected, adminID, _ string) (question.Question, error) {
	var result question.Question
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		expectedID, err := uuid(expected)
		if err != nil {
			return question.ErrConflict
		}
		admin, err := uuid(adminID)
		if err != nil {
			return question.ErrInvalidInput
		}
		locked, err := q.LockQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrNotFound
		}
		if err != nil {
			return err
		}
		if locked.CurrentRevisionID != expectedID {
			return question.ErrConflict
		}
		next, err := q.NextQuestionRevisionNumber(ctx, qid)
		if err != nil {
			return err
		}
		created, err := q.CreateQuestionRevision(ctx, sqlc.CreateQuestionRevisionParams{QuestionID: qid, Text: fields.Text, Category: fields.Category, RelationshipFit: fields.RelationshipFit, ModeFit: fields.ModeFit, Intensity: fields.Intensity, RevisionNumber: next, CreatedByAdminUserID: admin})
		if err != nil {
			return err
		}
		if err := q.SetCurrentQuestionRevision(ctx, sqlc.SetCurrentQuestionRevisionParams{ID: qid, CurrentRevisionID: created.ID}); err != nil {
			return err
		}
		result, err = readQuestion(ctx, q, qid)
		return err
	})
	return result, err
}

func (s *Store) SetActivity(ctx context.Context, id, action, adminID string) (question.Question, error) {
	var result question.Question
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		admin, err := uuid(adminID)
		if err != nil {
			return question.ErrInvalidInput
		}
		locked, err := q.LockQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrNotFound
		}
		if err != nil {
			return err
		}
		current, err := q.GetQuestionRevision(ctx, sqlc.GetQuestionRevisionParams{ID: locked.CurrentRevisionID, QuestionID: qid})
		if err != nil {
			return err
		}
		active := action != "deactivate"
		if active && current.WithdrawnAt.Valid {
			return question.ErrCurrentWithdrawn
		}
		if err := q.SetQuestionActivity(ctx, sqlc.SetQuestionActivityParams{ID: qid, IsActive: active}); err != nil {
			return err
		}
		if err := q.AddQuestionLifecycleEvent(ctx, sqlc.AddQuestionLifecycleEventParams{QuestionID: qid, RevisionID: locked.CurrentRevisionID, Action: map[string]string{"activate": "activated", "reactivate": "reactivated", "deactivate": "deactivated"}[action], AdminUserID: admin}); err != nil {
			return err
		}
		result, err = readQuestion(ctx, q, qid)
		return err
	})
	return result, err
}

func (s *Store) Withdraw(ctx context.Context, id, revisionID, reason, adminID string) (question.Revision, error) {
	var result question.Revision
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		q := sqlc.New(db)
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		rid, err := uuid(revisionID)
		if err != nil {
			return question.ErrRevisionNotFound
		}
		admin, err := uuid(adminID)
		if err != nil {
			return question.ErrInvalidInput
		}
		locked, err := q.LockQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrNotFound
		} else if err != nil {
			return err
		}
		revision, err := q.GetQuestionRevision(ctx, sqlc.GetQuestionRevisionParams{ID: rid, QuestionID: qid})
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrRevisionNotFound
		}
		if err != nil {
			return err
		}
		if !revision.WithdrawnAt.Valid {
			if err := q.WithdrawQuestionRevision(ctx, sqlc.WithdrawQuestionRevisionParams{ID: rid, QuestionID: qid, WithdrawnReason: pgtype.Text{String: reason, Valid: true}, WithdrawnByAdminUserID: admin}); err != nil {
				return err
			}
			if err := s.invalidator.InvalidateUnresolvedCandidates(ctx, withdrawalExecutor{db: db}, rid.String()); err != nil {
				return err
			}
			if locked.CurrentRevisionID == rid && locked.IsActive {
				if err := q.SetQuestionActivity(ctx, sqlc.SetQuestionActivityParams{ID: qid, IsActive: false}); err != nil {
					return err
				}
				if err := q.AddQuestionLifecycleEvent(ctx, sqlc.AddQuestionLifecycleEventParams{QuestionID: qid, RevisionID: rid, Action: "deactivated", AdminUserID: admin, Reason: pgtype.Text{String: "current revision withdrawn", Valid: true}}); err != nil {
					return err
				}
			}
			if err := q.AddQuestionLifecycleEvent(ctx, sqlc.AddQuestionLifecycleEventParams{QuestionID: qid, RevisionID: rid, Action: "revision_withdrawn", AdminUserID: admin, Reason: pgtype.Text{String: reason, Valid: true}}); err != nil {
				return err
			}
		}
		result = toRevision(revision)
		result.Withdrawn = true
		return nil
	})
	return result, err
}

func (s *Store) Get(ctx context.Context, id string) (question.Question, error) {
	var result question.Question
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		value, err := sqlc.New(db).GetQuestion(ctx, qid)
		if errors.Is(err, pgx.ErrNoRows) {
			return question.ErrNotFound
		}
		if err != nil {
			return err
		}
		result = toQuestion(value)
		return nil
	})
	return result, err
}
func (s *Store) List(ctx context.Context, filter question.ListFilter) ([]question.Question, error) {
	result := []question.Question{}
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		rows, err := sqlc.New(db).ListQuestions(ctx, sqlc.ListQuestionsParams{Column1: filter.Search, Column2: filter.Category, Column3: filter.Intensity, Column4: filter.RelationshipFit, Column5: filter.ModeFit, Limit: filter.Limit, Offset: filter.Offset})
		if err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, question.Question{ID: row.ID.String(), CurrentRevisionID: row.CurrentRevisionID.String(), IsActive: row.IsActive, Current: question.Revision{ID: row.CurrentRevisionID.String(), QuestionID: row.ID.String(), RevisionFields: question.RevisionFields{Text: row.Text, Category: row.Category, RelationshipFit: row.RelationshipFit, ModeFit: row.ModeFit, Intensity: row.Intensity}, RevisionNumber: row.RevisionNumber, Withdrawn: row.WithdrawnAt.Valid}})
		}
		return nil
	})
	return result, err
}
func (s *Store) ListRevisions(ctx context.Context, id string) ([]question.Revision, error) {
	result := []question.Revision{}
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		qid, err := uuid(id)
		if err != nil {
			return question.ErrNotFound
		}
		rows, err := sqlc.New(db).ListQuestionRevisions(ctx, qid)
		if err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, toRevision(row))
		}
		return nil
	})
	return result, err
}

func (s *Store) FindDuplicates(ctx context.Context, text, excludeQuestionID string) ([]question.DuplicateMatch, error) {
	var result []question.DuplicateMatch
	if excludeQuestionID != "" {
		if _, err := uuid(excludeQuestionID); err != nil {
			return nil, question.ErrNotFound
		}
	}
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		rows, err := sqlc.New(db).FindQuestionDuplicates(ctx, sqlc.FindQuestionDuplicatesParams{Text: text, ExcludeQuestionID: excludeQuestionID})
		if err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, question.DuplicateMatch{QuestionID: row.ID.String(), Text: row.Text, RevisionNumber: row.RevisionNumber, IsActive: row.IsActive})
		}
		return nil
	})
	return result, err
}

func readQuestion(ctx context.Context, q *sqlc.Queries, id pgtype.UUID) (question.Question, error) {
	row, err := q.GetQuestion(ctx, id)
	if err != nil {
		return question.Question{}, err
	}
	return toQuestion(row), nil
}
func toQuestion(row sqlc.GetQuestionRow) question.Question {
	return question.Question{ID: row.ID.String(), CurrentRevisionID: row.CurrentRevisionID.String(), IsActive: row.IsActive, Current: question.Revision{ID: row.RevisionID.String(), QuestionID: row.ID.String(), RevisionFields: question.RevisionFields{Text: row.Text, Category: row.Category, RelationshipFit: row.RelationshipFit, ModeFit: row.ModeFit, Intensity: row.Intensity}, RevisionNumber: row.RevisionNumber, Withdrawn: row.WithdrawnAt.Valid}}
}
func toRevision(row sqlc.QuestionRevision) question.Revision {
	return question.Revision{ID: row.ID.String(), QuestionID: row.QuestionID.String(), RevisionFields: question.RevisionFields{Text: row.Text, Category: row.Category, RelationshipFit: row.RelationshipFit, ModeFit: row.ModeFit, Intensity: row.Intensity}, RevisionNumber: row.RevisionNumber, Withdrawn: row.WithdrawnAt.Valid}
}
func uuid(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}
