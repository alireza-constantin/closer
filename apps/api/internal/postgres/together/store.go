// Package together is the PostgreSQL adapter for the Together domain port.
package together

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	domain "github.com/alireza-constantin/closer/apps/api/internal/together"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const pageSize = 20

type Store struct{ pool *postgres.Pool }

func NewStore(pool *postgres.Pool) *Store { return &Store{pool: pool} }

type pairContext struct {
	relationship string
	activeEra    string
}

type sessionRecord struct {
	id, pairID, membershipEraID, category, startedBy, seed string
	startedAt                                              time.Time
	endedAt                                                *time.Time
}

type occurrence struct {
	id, questionID, revisionID, text, intensity string
	position                                    int32
	liked                                       bool
}

type candidate struct {
	questionID, revisionID, text, category, intensity string
}

func (s *Store) Start(ctx context.Context, input domain.StartInput) (domain.StartResult, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.StartResult{}, domain.ErrPairNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.StartResult{}, domain.ErrPairNotFound
	}
	var result domain.StartResult
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		contextValue, err := lockPairAndActor(ctx, db, pairID, participantID)
		if err != nil {
			return err
		}
		if !categoryAllowed(input.Category, contextValue.relationship) {
			return domain.ErrActionInvalid
		}
		if input.ClientRequestID != "" {
			var existingID string
			err := db.QueryRow(ctx, `SELECT id::text FROM together_session WHERE pair_id=$1 AND started_by_participant_id=$2 AND start_request_id=$3::uuid FOR UPDATE`, pairID, participantID, input.ClientRequestID).Scan(&existingID)
			if err == nil {
				current, currentErr := currentOccurrence(ctx, db, existingID)
				if currentErr != nil {
					return currentErr
				}
				if current == nil {
					return domain.ErrSessionExhausted
				}
				result = domain.StartResult{SessionID: existingID, QuestionID: current.questionID, QuestionRevisionID: current.revisionID}
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		seed := input.SelectionSeed
		if seed == "" {
			seed, err = randomSeed()
			if err != nil {
				return err
			}
		}
		first, err := nextCandidate(ctx, db, "", contextValue.relationship, input.Category, seed, 0)
		if err != nil {
			return err
		}
		if first == nil {
			return domain.ErrQuestionUnavailable
		}
		var sessionID string
		err = db.QueryRow(ctx, `
			INSERT INTO together_session (pair_id, membership_era_id, category, started_by_participant_id, start_request_id, selection_seed)
			VALUES ($1, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, '')::uuid, $6)
			RETURNING id::text`, pairID, nullableString(contextValue.activeEra), input.Category, participantID, nullableString(input.ClientRequestID), seed).Scan(&sessionID)
		if err != nil {
			return err
		}
		var occurrenceID string
		if err := db.QueryRow(ctx, `INSERT INTO together_session_question (session_id, question_id, question_revision_id, position) VALUES ($1,$2,$3,1) RETURNING id::text`, sessionID, first.questionID, first.revisionID).Scan(&occurrenceID); err != nil {
			return err
		}
		result = domain.StartResult{SessionID: sessionID, QuestionID: first.questionID, QuestionRevisionID: first.revisionID}
		return nil
	})
	return result, err
}

func (s *Store) Playback(ctx context.Context, input domain.PlaybackInput) (domain.Playback, error) {
	var result domain.Playback
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		record, contextValue, err := loadAuthorizedSession(ctx, db, input)
		if err != nil {
			return err
		}
		current, err := currentOccurrence(ctx, db, record.id)
		if err != nil {
			return err
		}
		activeEra, err := activeEraID(ctx, db, input.PairID)
		if err != nil {
			return err
		}
		active := record.endedAt == nil && record.membershipEraID == activeEra
		transitions := int32(0)
		if current != nil {
			transitions, err = completedTransitions(ctx, db, record.id)
			if err != nil {
				return err
			}
		}
		result = playbackFrom(record, contextValue.relationship, current, transitions, !active || current == nil)
		if current != nil && active {
			result.Pages, err = s.loadPools(ctx, db, record, contextValue.relationship)
			if err != nil {
				return err
			}
		}
		return nil
	})
	return result, err
}

func (s *Store) Page(ctx context.Context, input domain.PageInput) (domain.QuestionPage, error) {
	var result domain.QuestionPage
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		record, contextValue, err := requireMutable(ctx, db, input.PlaybackInput)
		if err != nil {
			return err
		}
		if record.category == "" || !categoryAllowed(record.category, contextValue.relationship) {
			return domain.ErrActionInvalid
		}
		items, err := listCandidates(ctx, db, input.SessionID, contextValue.relationship, record.category, record.seed, input.Band)
		if err != nil {
			return err
		}
		if input.Cursor != "" {
			decoded, decodeErr := base64.RawURLEncoding.DecodeString(input.Cursor)
			if decodeErr != nil || len(decoded) == 0 {
				return domain.ErrActionInvalid
			}
			cursorID := string(decoded)
			cursorRank := rank(record.seed, cursorID)
			filtered := items[:0]
			for _, item := range items {
				if rank(record.seed, item.questionID) > cursorRank || rank(record.seed, item.questionID) == cursorRank && item.questionID > cursorID {
					filtered = append(filtered, item)
				}
			}
			items = filtered
		}
		result = pageFromCandidates(items)
		return nil
	})
	return result, err
}

func (s *Store) Advance(ctx context.Context, input domain.AdvanceInput) (domain.AdvanceResult, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return domain.AdvanceResult{}, domain.ErrSessionNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return domain.AdvanceResult{}, domain.ErrSessionNotFound
	}
	var result domain.AdvanceResult
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		record, contextValue, err := requireMutableLocked(ctx, db, input.PlaybackInput, pairID, participantID)
		if err != nil {
			return err
		}
		if record.endedAt != nil {
			return domain.ErrSessionEnded
		}
		if input.ClientRequestID != "" {
			var occurrenceID string
			err := db.QueryRow(ctx, `SELECT id::text FROM together_session_question WHERE session_id=$1 AND advance_request_id=$2::uuid`, input.SessionID, input.ClientRequestID).Scan(&occurrenceID)
			if err == nil {
				return fillAdvanceResult(ctx, db, input.SessionID, &result)
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		current, err := currentOccurrence(ctx, db, input.SessionID)
		if err != nil {
			return err
		}
		if current == nil {
			result = domain.AdvanceResult{Kind: "EXHAUSTED", SessionID: input.SessionID}
			return nil
		}
		if input.CurrentQuestionID != "" && input.CurrentQuestionID != current.questionID {
			return domain.ErrActionInvalid
		}
		skipped := ""
		if input.Action == "skip" {
			skipped = "clock_timestamp()"
		}
		query := `UPDATE together_session_question SET advanced_at=clock_timestamp(), advance_request_id=NULLIF($2,'')::uuid WHERE id=$1`
		if skipped != "" {
			query = `UPDATE together_session_question SET skipped_at=clock_timestamp(), advanced_at=clock_timestamp(), advance_request_id=NULLIF($2,'')::uuid WHERE id=$1`
		}
		if _, err := db.Exec(ctx, query, current.id, input.ClientRequestID); err != nil {
			return err
		}
		transitions, err := completedTransitions(ctx, db, input.SessionID)
		if err != nil {
			return err
		}
		next, err := nextCandidate(ctx, db, input.SessionID, contextValue.relationship, record.category, record.seed, int(transitions))
		if err != nil {
			return err
		}
		if next == nil {
			result = domain.AdvanceResult{Kind: "EXHAUSTED", SessionID: input.SessionID, CompletedNextTransitions: transitions}
			return nil
		}
		if input.NextQuestionID != "" && (input.NextQuestionID != next.questionID || input.NextQuestionRevisionID != next.revisionID) {
			return domain.ErrActionInvalid
		}
		if _, err := db.Exec(ctx, `INSERT INTO together_session_question (session_id, question_id, question_revision_id, position) VALUES ($1,$2,$3,$4)`, input.SessionID, next.questionID, next.revisionID, current.position+1); err != nil {
			return err
		}
		result = domain.AdvanceResult{Kind: "QUESTION", SessionID: input.SessionID, QuestionID: next.questionID, QuestionRevisionID: next.revisionID, Position: current.position + 1, CompletedNextTransitions: transitions}
		return nil
	})
	return result, err
}

func (s *Store) Like(ctx context.Context, input domain.LikeInput) (domain.Playback, error) {
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		record, _, err := requireMutableLockedByInput(ctx, db, input.PlaybackInput)
		if err != nil {
			return err
		}
		if record.endedAt != nil {
			return domain.ErrSessionEnded
		}
		current, err := currentOccurrence(ctx, db, input.SessionID)
		if err != nil {
			return err
		}
		if current == nil {
			return domain.ErrSessionExhausted
		}
		if input.CurrentQuestionID != "" && input.CurrentQuestionID != current.questionID {
			return domain.ErrActionInvalid
		}
		value := "NULL"
		if input.Liked {
			value = "clock_timestamp()"
		}
		_, err = db.Exec(ctx, fmt.Sprintf(`UPDATE together_session_question SET liked_at=%s WHERE id=$1`, value), current.id)
		return err
	})
	if err != nil {
		return domain.Playback{}, err
	}
	return s.Playback(ctx, input.PlaybackInput)
}

func (s *Store) End(ctx context.Context, input domain.PlaybackInput) (domain.Playback, error) {
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		record, _, err := requireMutableLockedByInput(ctx, db, input)
		if err != nil {
			return err
		}
		if record.endedAt == nil {
			_, err = db.Exec(ctx, `UPDATE together_session SET ended_at=clock_timestamp() WHERE id=$1 AND ended_at IS NULL`, input.SessionID)
		}
		return err
	})
	if err != nil {
		return domain.Playback{}, err
	}
	return s.Playback(ctx, input)
}

func (s *Store) loadPools(ctx context.Context, db postgres.QueryDB, record sessionRecord, relationship string) (domain.QuestionPools, error) {
	var pools domain.QuestionPools
	for _, band := range []string{"light", "medium", "deep"} {
		page, err := loadPage(ctx, db, record, relationship, band, "")
		if err != nil {
			return pools, err
		}
		switch band {
		case "light":
			pools.Light = page
		case "medium":
			pools.Medium = page
		case "deep":
			pools.Deep = page
		}
	}
	return pools, nil
}

func loadPage(ctx context.Context, db postgres.QueryDB, record sessionRecord, relationship, band, cursor string) (domain.QuestionPage, error) {
	items, err := listCandidates(ctx, db, record.id, relationship, record.category, record.seed, band)
	if err != nil {
		return domain.QuestionPage{}, err
	}
	if cursor != "" {
		cursorRank := rank(record.seed, cursor)
		items = filterAfter(items, record.seed, cursor, cursorRank)
	}
	return pageFromCandidates(items), nil
}

func pageFromCandidates(items []candidate) domain.QuestionPage {
	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
	}
	result := domain.QuestionPage{Items: make([]domain.Question, 0, len(items)), HasMore: hasMore}
	for _, item := range items {
		result.Items = append(result.Items, domain.Question{QuestionID: item.questionID, QuestionRevisionID: item.revisionID, Text: item.text, Intensity: item.intensity})
	}
	if hasMore {
		cursor := base64.RawURLEncoding.EncodeToString([]byte(items[len(items)-1].questionID))
		result.NextCursor = &cursor
	}
	return result
}

func listCandidates(ctx context.Context, db postgres.QueryDB, sessionID, relationship, category, seed, band string) ([]candidate, error) {
	rows, err := db.Query(ctx, `
		SELECT q.id::text, r.id::text, r.text, r.category, r.intensity
		FROM question q
		JOIN question_revision r ON r.id=q.current_revision_id
		WHERE q.is_active
		  AND r.category=$1
		  AND r.relationship_fit IN ('both',$2)
		  AND r.mode_fit IN ('both','together')
		  AND r.intensity=$3
		  AND r.withdrawn_at IS NULL
		  AND ($4='' OR NOT EXISTS (SELECT 1 FROM together_session_question sq WHERE sq.session_id=NULLIF($4,'')::uuid AND sq.question_id=q.id))`, category, relationship, band, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]candidate, 0)
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.questionID, &item.revisionID, &item.text, &item.category, &item.intensity); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := rank(seed, items[i].questionID), rank(seed, items[j].questionID)
		return left < right || left == right && items[i].questionID < items[j].questionID
	})
	return items, nil
}

func filterAfter(items []candidate, seed, cursor, cursorRank string) []candidate {
	filtered := items[:0]
	for _, item := range items {
		value := rank(seed, item.questionID)
		if value > cursorRank || value == cursorRank && item.questionID > cursor {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func nextCandidate(ctx context.Context, db postgres.QueryDB, sessionID, relationship, category, seed string, transitions int) (*candidate, error) {
	bands := []string{"light", "medium", "deep"}
	if transitions >= 4 {
		bands = []string{"deep", "medium", "light"}
	} else if transitions >= 2 {
		bands = []string{"medium", "light", "deep"}
	}
	for _, band := range bands {
		items, err := listCandidates(ctx, db, sessionID, relationship, category, seed, band)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			return &items[0], nil
		}
	}
	return nil, nil
}

func rank(seed, questionID string) string {
	digest := sha256.Sum256([]byte("closer:together:" + seed + ":" + questionID))
	return hex.EncodeToString(digest[:])
}

func currentOccurrence(ctx context.Context, db postgres.QueryDB, sessionID string) (*occurrence, error) {
	sessionUUID, err := parseUUID(sessionID)
	if err != nil {
		return nil, domain.ErrSessionNotFound
	}
	var item occurrence
	var liked bool
	err = db.QueryRow(ctx, `SELECT sq.id::text, sq.question_id::text, sq.question_revision_id::text, r.text, r.intensity, sq.position, (sq.liked_at IS NOT NULL) FROM together_session_question sq JOIN question_revision r ON r.id=sq.question_revision_id WHERE sq.session_id=$1 AND sq.advanced_at IS NULL ORDER BY sq.position LIMIT 1`, sessionUUID).Scan(&item.id, &item.questionID, &item.revisionID, &item.text, &item.intensity, &item.position, &liked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.liked = liked
	return &item, nil
}

func completedTransitions(ctx context.Context, db postgres.QueryDB, sessionID string) (int32, error) {
	sessionUUID, err := parseUUID(sessionID)
	if err != nil {
		return 0, domain.ErrSessionNotFound
	}
	var count int32
	err = db.QueryRow(ctx, `SELECT count(*)::int FROM together_session_question WHERE session_id=$1 AND advanced_at IS NOT NULL AND skipped_at IS NULL`, sessionUUID).Scan(&count)
	return count, err
}

func (s *Store) _unused() {}

func loadAuthorizedSession(ctx context.Context, db postgres.QueryDB, input domain.PlaybackInput) (sessionRecord, pairContext, error) {
	sessionID, err := parseUUID(input.SessionID)
	if err != nil {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	var result sessionRecord
	var contextValue pairContext
	var startedAt, endedAt pgtype.Timestamptz
	err = db.QueryRow(ctx, `
		SELECT ts.id::text, ts.pair_id::text, COALESCE(ts.membership_era_id::text,''), ts.category, ts.started_by_participant_id::text, ts.selection_seed, ts.started_at, ts.ended_at, p.relationship_type::text
		FROM together_session ts JOIN pair p ON p.id=ts.pair_id
		WHERE ts.id=$1 AND ts.pair_id=$2 AND (
			(ts.membership_era_id IS NULL AND ts.started_by_participant_id=$3)
			OR (ts.membership_era_id IS NOT NULL AND EXISTS (SELECT 1 FROM pair_membership_era e JOIN pair_membership m ON m.id IN (e.first_membership_id,e.second_membership_id) WHERE e.id=ts.membership_era_id AND m.participant_id=$3))
		)`, sessionID, pairID, participantID).Scan(&result.id, &result.pairID, &result.membershipEraID, &result.category, &result.startedBy, &result.seed, &startedAt, &endedAt, &contextValue.relationship)
	if errors.Is(err, pgx.ErrNoRows) {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	if err != nil {
		return sessionRecord{}, pairContext{}, err
	}
	result.startedAt = startedAt.Time
	if endedAt.Valid {
		value := endedAt.Time
		result.endedAt = &value
	}
	return result, contextValue, nil
}

func requireMutable(ctx context.Context, db postgres.QueryDB, input domain.PlaybackInput) (sessionRecord, pairContext, error) {
	return requireMutableLockedByInput(ctx, db, input)
}

func requireMutableLockedByInput(ctx context.Context, db postgres.QueryDB, input domain.PlaybackInput) (sessionRecord, pairContext, error) {
	pairID, err := parseUUID(input.PairID)
	if err != nil {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	participantID, err := parseUUID(input.ParticipantID)
	if err != nil {
		return sessionRecord{}, pairContext{}, domain.ErrSessionNotFound
	}
	return requireMutableLocked(ctx, db, input, pairID, participantID)
}

func requireMutableLocked(ctx context.Context, db postgres.QueryDB, input domain.PlaybackInput, pairID, participantID pgtype.UUID) (sessionRecord, pairContext, error) {
	contextValue, err := lockPairAndActor(ctx, db, pairID, participantID)
	if err != nil {
		return sessionRecord{}, pairContext{}, err
	}
	record, _, err := loadAuthorizedSession(ctx, db, input)
	if err != nil {
		return sessionRecord{}, pairContext{}, err
	}
	if record.membershipEraID != contextValue.activeEra {
		return sessionRecord{}, pairContext{}, domain.ErrSessionEnded
	}
	return record, contextValue, nil
}

func lockPairAndActor(ctx context.Context, db postgres.QueryDB, pairID, participantID pgtype.UUID) (pairContext, error) {
	var relationship, terminated string
	if err := db.QueryRow(ctx, `SELECT relationship_type::text, COALESCE(terminated_at::text,'') FROM pair WHERE id=$1 FOR UPDATE`, pairID).Scan(&relationship, &terminated); errors.Is(err, pgx.ErrNoRows) {
		return pairContext{}, domain.ErrPairNotFound
	} else if err != nil {
		return pairContext{}, err
	} else if terminated != "" {
		return pairContext{}, domain.ErrPairNotFound
	}
	var membershipID string
	if err := db.QueryRow(ctx, `SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL`, pairID, participantID).Scan(&membershipID); errors.Is(err, pgx.ErrNoRows) {
		return pairContext{}, domain.ErrPairNotFound
	} else if err != nil {
		return pairContext{}, err
	}
	era, err := activeEraID(ctx, db, pairID.String())
	if err != nil {
		return pairContext{}, err
	}
	return pairContext{relationship: relationship, activeEra: era}, nil
}

func activeEraID(ctx context.Context, db postgres.QueryDB, pairID string) (string, error) {
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return "", domain.ErrPairNotFound
	}
	var era string
	err = db.QueryRow(ctx, `SELECT id::text FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL LIMIT 1`, pairUUID).Scan(&era)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return era, err
}

func categoryAllowed(category, relationship string) bool {
	if category == "relationship" {
		return relationship == "partner"
	}
	if category == "friendship" {
		return relationship == "friend"
	}
	return category == "fun" || category == "deep" || category == "memories"
}

func playbackFrom(record sessionRecord, relationship string, current *occurrence, transitions int32, exhausted bool) domain.Playback {
	result := domain.Playback{ID: record.id, PairID: record.pairID, RelationshipType: relationship, Category: record.category, StartedByParticipantID: record.startedBy, StartedAt: record.startedAt.UTC().Format(time.RFC3339Nano), Exhausted: exhausted, CompletedNextTransitions: transitions, Pages: emptyPools()}
	if record.endedAt != nil {
		value := record.endedAt.UTC().Format(time.RFC3339Nano)
		result.EndedAt = &value
	}
	if current != nil {
		result.Question = &domain.Question{QuestionID: current.questionID, QuestionRevisionID: current.revisionID, Text: current.text, Intensity: current.intensity, Position: current.position, Liked: current.liked}
	}
	return result
}

func emptyPools() domain.QuestionPools {
	return domain.QuestionPools{Light: emptyPage(), Medium: emptyPage(), Deep: emptyPage()}
}
func emptyPage() domain.QuestionPage { return domain.QuestionPage{Items: []domain.Question{}} }

func randomSeed() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func nullableString(value string) string { return value }

func fillAdvanceResult(ctx context.Context, db postgres.QueryDB, sessionID string, result *domain.AdvanceResult) error {
	current, err := currentOccurrence(ctx, db, sessionID)
	if err != nil {
		return err
	}
	transitions, err := completedTransitions(ctx, db, sessionID)
	if err != nil {
		return err
	}
	if current == nil {
		*result = domain.AdvanceResult{Kind: "EXHAUSTED", SessionID: sessionID, CompletedNextTransitions: transitions}
	} else {
		*result = domain.AdvanceResult{Kind: "QUESTION", SessionID: sessionID, QuestionID: current.questionID, QuestionRevisionID: current.revisionID, Position: current.position, CompletedNextTransitions: transitions}
	}
	return nil
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return result, nil
}
