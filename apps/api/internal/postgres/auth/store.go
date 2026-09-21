// Package auth is the PostgreSQL adapter for the auth application module.
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
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

func (s *Store) CreateAnonymous(
	ctx context.Context,
	userID string,
	sessionID string,
	tokenHash []byte,
	now time.Time,
	expiresAt time.Time,
) error {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return err
	}
	sessionUUID, err := parseUUID(sessionID)
	if err != nil {
		return err
	}
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if _, err := queries.CreateAuthUser(ctx, sqlc.CreateAuthUserParams{
			ID:        userUUID,
			Kind:      string(auth.UserKindAnonymous),
			CreatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
		_, err := queries.CreateAuthSession(ctx, sqlc.CreateAuthSessionParams{
			ID:         sessionUUID,
			AuthUserID: userUUID,
			TokenHash:  tokenHash,
			CreatedAt:  timestamptz(now),
			ExpiresAt:  timestamptz(expiresAt),
		})
		return err
	})
}

func (s *Store) FindSession(ctx context.Context, tokenHash []byte, now time.Time) (auth.SessionState, error) {
	var state auth.SessionState
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, err := sqlc.New(db).GetAuthSessionActor(ctx, sqlc.GetAuthSessionActorParams{
			TokenHash: tokenHash,
			Now:       timestamptz(now),
		})
		if err != nil {
			return err
		}
		state = auth.SessionState{
			Actor: auth.Actor{
				AuthUserID: formatUUID(row.AuthUserID),
				Kind:       auth.UserKind(row.Kind),
			},
			SessionID:  formatUUID(row.SessionID),
			CreatedAt:  row.SessionCreatedAt.Time,
			ExpiresAt:  row.ExpiresAt.Time,
			LastUsedAt: row.LastUsedAt.Time,
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.SessionState{}, auth.ErrUnauthenticated
	}
	return state, err
}

func (s *Store) RenewSession(ctx context.Context, sessionID string, now time.Time, expiresAt time.Time) error {
	id, err := parseUUID(sessionID)
	if err != nil {
		return err
	}
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, err := sqlc.New(db).RenewAuthSession(ctx, sqlc.RenewAuthSessionParams{
			ID:         id,
			ExpiresAt:  timestamptz(expiresAt),
			LastUsedAt: timestamptz(now),
		})
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.ErrUnauthenticated
	}
	return err
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash []byte, now time.Time) error {
	return s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, err := sqlc.New(db).RevokeAuthSession(ctx, sqlc.RevokeAuthSessionParams{
			TokenHash: tokenHash,
			RevokedAt: timestamptz(now),
		})
		return err
	})
}

func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time, limit int32) (int64, error) {
	var deleted int64
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var err error
		deleted, err = sqlc.New(db).DeleteExpiredAuthSessions(ctx, sqlc.DeleteExpiredAuthSessionsParams{
			ExpiresAt: timestamptz(now),
			Limit:     limit,
		})
		return err
	})
	return deleted, err
}

func timestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return result, nil
}

func formatUUID(value pgtype.UUID) string {
	return value.String()
}
