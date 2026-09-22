// Package pair implements the Pair persistence port.
package pair

import (
	"context"
	"errors"

	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct {
	pool *postgres.Pool
}

func NewStore(pool *postgres.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) WithinTx(ctx context.Context, callback func(pair.Tx) error) error {
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		return callback(txStore{db: db, publisher: postgres.NewTransactionalRealtimePublisher(db)})
	})
}

func (s *Store) ListSpaces(ctx context.Context, participantID string) ([]pair.Space, error) {
	id, err := parseUUID(participantID)
	if err != nil {
		return nil, err
	}
	spaces := make([]pair.Space, 0)
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		rows, queryErr := sqlc.New(db).ListParticipantSpaces(ctx, id)
		if queryErr != nil {
			return queryErr
		}
		for _, row := range rows {
			spaces = append(spaces, pair.Space{
				PairID: row.PairID.String(), RelationshipType: pair.RelationshipType(row.RelationshipType),
				State: row.State, OtherParticipantDisplayName: nullableText(row.OtherParticipantDisplayName),
				IntendedPersonName: nullableText(row.IntendedPersonName),
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for index := range spaces {
		if spaces[index].State == "connected" {
			spaces[index].IntendedPersonName = nil
		}
	}
	return spaces, nil
}

func (s *Store) GetActivePairAccess(ctx context.Context, participantID, pairID string) (pair.Access, error) {
	actorID, err := parseUUID(participantID)
	if err != nil {
		return pair.Access{}, err
	}
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return pair.Access{}, pair.ErrPairNotFound
	}
	var result pair.Access
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, queryErr := sqlc.New(db).GetActivePairAccess(ctx, sqlc.GetActivePairAccessParams{
			ParticipantID: actorID, PairID: pairUUID,
		})
		if queryErr != nil {
			return queryErr
		}
		result = pair.Access{
			PairID: row.PairID.String(), RelationshipType: pair.RelationshipType(row.RelationshipType),
			IntendedPersonName: nullableText(row.IntendedPersonName),
			MembershipID:       row.ActorMembershipID.String(), ActorSlot: pair.Slot(row.ActorSlot),
			OtherParticipantID:          nullableUUID(row.OtherParticipantID),
			OtherParticipantDisplayName: nullableText(row.OtherParticipantDisplayName),
			MembershipEraID:             nullableUUID(row.MembershipEraID),
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return pair.Access{}, pair.ErrPairNotFound
	}
	return result, err
}

func (s *Store) ListActiveMembers(ctx context.Context, pairID string) ([]pair.Member, error) {
	id, err := parseUUID(pairID)
	if err != nil {
		return nil, pair.ErrPairNotFound
	}
	members := make([]pair.Member, 0, 2)
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		rows, queryErr := sqlc.New(db).ListActivePairMembers(ctx, id)
		if queryErr != nil {
			return queryErr
		}
		for _, row := range rows {
			members = append(members, pair.Member{Slot: pair.Slot(row.Slot), DisplayName: row.DisplayName})
		}
		return nil
	})
	return members, err
}

func (s *Store) FindFormerTerminatedPair(ctx context.Context, pairID, participantID string) (string, error) {
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return "", pair.ErrPairNotFound
	}
	actorID, err := parseUUID(participantID)
	if err != nil {
		return "", pair.ErrPairNotFound
	}
	var found pgtype.UUID
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var queryErr error
		found, queryErr = sqlc.New(db).FindFormerTerminatedPair(ctx, sqlc.FindFormerTerminatedPairParams{
			PairID: pairUUID, ParticipantID: actorID,
		})
		return queryErr
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", pair.ErrPairNotFound
	}
	return found.String(), err
}

type txStore struct {
	db        postgres.QueryDB
	publisher realtime.Publisher
}

func (s txStore) Publish(ctx context.Context, event realtime.Event) error {
	return s.publisher.Publish(ctx, event)
}

func (s txStore) ParticipantExists(ctx context.Context, participantID string) (bool, error) {
	id, err := parseUUID(participantID)
	if err != nil {
		return false, err
	}
	return sqlc.New(s.db).ParticipantExists(ctx, id)
}

func (s txStore) CreatePair(ctx context.Context, value pair.Pair, requestID string) (*pair.Pair, error) {
	var request pgtype.UUID
	if requestID != "" {
		parsed, err := parseUUID(requestID)
		if err != nil {
			return nil, err
		}
		request = parsed
	}
	name := pgtype.Text{String: "", Valid: false}
	if value.IntendedPersonName != nil {
		name = pgtype.Text{String: *value.IntendedPersonName, Valid: true}
	}
	row, err := sqlc.New(s.db).CreatePair(ctx, sqlc.CreatePairParams{
		RelationshipType:   sqlc.PairRelationshipType(value.RelationshipType),
		IntendedPersonName: name, CreationRequestID: request,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := toPair(row)
	return &result, nil
}

func (s txStore) GetCreatedPairByRequestAndParticipant(ctx context.Context, requestID, participantID string) (pair.Pair, error) {
	request, err := parseUUID(requestID)
	if err != nil {
		return pair.Pair{}, err
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return pair.Pair{}, err
	}
	row, err := sqlc.New(s.db).GetCreatedPairByRequestAndParticipant(ctx, sqlc.GetCreatedPairByRequestAndParticipantParams{
		CreationRequestID: request, ParticipantID: participantUUID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return pair.Pair{}, pair.ErrPairNotFound
	}
	if err != nil {
		return pair.Pair{}, err
	}
	return toPair(row), nil
}

func (s txStore) CreateCreatorMembership(ctx context.Context, pairID, participantID string) error {
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return err
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return err
	}
	_, err = sqlc.New(s.db).CreateCreatorMembership(ctx, sqlc.CreateCreatorMembershipParams{
		PairID: pairUUID, ParticipantID: participantUUID,
	})
	return err
}

func (s txStore) LockActivePair(ctx context.Context, pairID string) (bool, error) {
	id, err := parseUUID(pairID)
	if err != nil {
		return false, nil
	}
	_, err = sqlc.New(s.db).LockActivePair(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s txStore) ParticipantHasActiveMembership(ctx context.Context, pairID, participantID string) (bool, error) {
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return false, err
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return false, err
	}
	return sqlc.New(s.db).ParticipantHasActiveMembership(ctx, sqlc.ParticipantHasActiveMembershipParams{
		PairID: pairUUID, ParticipantID: participantUUID,
	})
}

func (s txStore) HasActiveSecondSlot(ctx context.Context, pairID string) (bool, error) {
	id, err := parseUUID(pairID)
	if err != nil {
		return false, err
	}
	return sqlc.New(s.db).HasActiveSecondSlot(ctx, id)
}

func (s txStore) UpdateIntendedPersonName(ctx context.Context, pairID, name string) (pair.Pair, error) {
	id, err := parseUUID(pairID)
	if err != nil {
		return pair.Pair{}, err
	}
	row, err := sqlc.New(s.db).UpdateIntendedPersonName(ctx, sqlc.UpdateIntendedPersonNameParams{
		PairID: id, IntendedPersonName: pgtype.Text{String: name, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return pair.Pair{}, pair.ErrPairNotFound
	}
	if err != nil {
		return pair.Pair{}, err
	}
	return toPair(row), nil
}

func toPair(row sqlc.Pair) pair.Pair {
	return pair.Pair{
		ID: row.ID.String(), RelationshipType: pair.RelationshipType(row.RelationshipType),
		IntendedPersonName: nullableText(row.IntendedPersonName),
	}
}

func nullableText(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func nullableUUID(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}
	result := value.String()
	return &result
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}
