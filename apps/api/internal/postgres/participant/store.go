// Package participant implements the Participant persistence port.
package participant

import (
	"context"
	"errors"

	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct {
	pool *postgres.Pool
}

func NewStore(pool *postgres.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) GetByAuthUserID(ctx context.Context, authUserID string) (participant.Participant, error) {
	userID, err := parseUUID(authUserID)
	if err != nil {
		return participant.Participant{}, err
	}
	var result participant.Participant
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, queryErr := sqlc.New(db).GetParticipantByAuthUserID(ctx, userID)
		if queryErr != nil {
			return queryErr
		}
		result = toParticipant(row)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return participant.Participant{}, participant.ErrNotFound
	}
	return result, err
}

func (s *Store) WithinTx(ctx context.Context, callback func(participant.Tx) error) error {
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		return callback(txStore{db: db})
	})
}

type txStore struct {
	db postgres.QueryDB
}

func (s txStore) GetByAuthUserID(ctx context.Context, authUserID string) (participant.Participant, error) {
	userID, err := parseUUID(authUserID)
	if err != nil {
		return participant.Participant{}, err
	}
	row, err := sqlc.New(s.db).GetParticipantByAuthUserID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return participant.Participant{}, participant.ErrNotFound
	}
	if err != nil {
		return participant.Participant{}, err
	}
	return toParticipant(row), nil
}

func (s txStore) Create(ctx context.Context, authUserID, displayName string) (*participant.Participant, error) {
	userID, err := parseUUID(authUserID)
	if err != nil {
		return nil, err
	}
	row, err := sqlc.New(s.db).CreateParticipant(ctx, sqlc.CreateParticipantParams{
		AuthUserID: userID, DisplayName: displayName,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := toParticipant(row)
	return &result, nil
}

func toParticipant(row sqlc.Participant) participant.Participant {
	return participant.Participant{
		ID: row.ID.String(), AuthUserID: row.AuthUserID.String(), DisplayName: row.DisplayName,
	}
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}
