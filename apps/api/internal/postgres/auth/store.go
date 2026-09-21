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
	"github.com/jackc/pgx/v5/pgconn"
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

func (s *Store) Register(
	ctx context.Context,
	userID string,
	sessionID string,
	email string,
	passwordHash string,
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
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if _, err := queries.CreateRegisteredAuthUser(ctx, sqlc.CreateRegisteredAuthUserParams{
			ID: userUUID, CreatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
		if err := queries.CreateAuthCredential(ctx, sqlc.CreateAuthCredentialParams{
			AuthUserID: userUUID, EmailNormalized: email, PasswordHash: passwordHash, CreatedAt: timestamptz(now),
		}); err != nil {
			return classifyCredentialWriteError(err)
		}
		_, err := queries.CreateAuthSession(ctx, sqlc.CreateAuthSessionParams{
			ID: sessionUUID, AuthUserID: userUUID, TokenHash: tokenHash,
			CreatedAt: timestamptz(now), ExpiresAt: timestamptz(expiresAt),
		})
		return err
	})
	return classifyCredentialWriteError(err)
}

func (s *Store) Upgrade(ctx context.Context, userID, email, passwordHash string, now time.Time) error {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return err
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		user, err := queries.LockAuthUserForUpgrade(ctx, userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return auth.ErrCannotUpgrade
			}
			return err
		}
		if user.Kind != string(auth.UserKindAnonymous) || user.DisabledAt.Valid {
			return auth.ErrCannotUpgrade
		}
		if err := queries.CreateAuthCredential(ctx, sqlc.CreateAuthCredentialParams{
			AuthUserID: userUUID, EmailNormalized: email, PasswordHash: passwordHash, CreatedAt: timestamptz(now),
		}); err != nil {
			return classifyCredentialWriteError(err)
		}
		updated, err := queries.UpgradeAnonymousAuthUser(ctx, userUUID)
		if err != nil {
			return err
		}
		if updated != 1 {
			return auth.ErrCannotUpgrade
		}
		return nil
	})
	return classifyCredentialWriteError(err)
}

func (s *Store) FindCredential(ctx context.Context, email string) (auth.Credential, error) {
	var credential auth.Credential
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, err := sqlc.New(db).GetCredentialByEmail(ctx, email)
		if err != nil {
			return err
		}
		credential = auth.Credential{
			Actor:        auth.Actor{AuthUserID: formatUUID(row.AuthUserID), Kind: auth.UserKind(row.Kind)},
			PasswordHash: row.PasswordHash,
			Disabled:     row.DisabledAt.Valid,
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Credential{}, auth.ErrCredentialNotFound
	}
	return credential, err
}

func (s *Store) CreateLoginSession(
	ctx context.Context,
	userID, sessionID string,
	tokenHash, previousTokenHash []byte,
	passwordHash string,
	now, expiresAt time.Time,
) error {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return err
	}
	sessionUUID, err := parseUUID(sessionID)
	if err != nil {
		return err
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if passwordHash != "" {
			if err := queries.UpdateAuthCredentialPasswordHash(ctx, sqlc.UpdateAuthCredentialPasswordHashParams{
				AuthUserID: userUUID, PasswordHash: passwordHash, PasswordUpdatedAt: timestamptz(now),
			}); err != nil {
				return err
			}
		}
		if len(previousTokenHash) != 0 {
			if _, err := queries.RevokeAuthSessionByTokenHash(ctx, sqlc.RevokeAuthSessionByTokenHashParams{
				TokenHash: previousTokenHash, RevokedAt: timestamptz(now),
			}); err != nil {
				return err
			}
		}
		created, err := queries.CreateAuthSessionForEnabledRegisteredUser(ctx, sqlc.CreateAuthSessionForEnabledRegisteredUserParams{
			ID: sessionUUID, ID_2: userUUID, TokenHash: tokenHash,
			CreatedAt: timestamptz(now), ExpiresAt: timestamptz(expiresAt),
		})
		if err != nil {
			return err
		}
		if created != 1 {
			return auth.ErrInvalidCredentials
		}
		return nil
	})
	return err
}

func (s *Store) RevokeAllSessions(ctx context.Context, userID string, now time.Time) error {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return err
	}
	return s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, err := sqlc.New(db).RevokeAuthSessionsForUser(ctx, sqlc.RevokeAuthSessionsForUserParams{
			AuthUserID: userUUID, RevokedAt: timestamptz(now),
		})
		return err
	})
}

func (s *Store) CountConsumerLoginAttempt(ctx context.Context, ipSubject, emailSubject string) (auth.LoginRateResult, error) {
	result := auth.LoginRateResult{}
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		for _, subject := range []struct{ scope, value string }{
			{scope: "consumer_login_ip", value: ipSubject},
			{scope: "consumer_login_email", value: emailSubject},
		} {
			row, err := queries.UpsertAuthRateLimit(ctx, sqlc.UpsertAuthRateLimitParams{
				Scope: subject.scope, Subject: subject.value,
			})
			if err != nil {
				return err
			}
			if row.Count > auth.ConsumerLoginLimit {
				result.Limited = true
				retryAfter := time.Duration(row.RetryAfterSeconds) * time.Second
				if retryAfter > result.RetryAfter {
					result.RetryAfter = retryAfter
				}
			}
		}
		return nil
	})
	return result, err
}

func (s *Store) DeleteOldRateLimits(ctx context.Context, now time.Time) (int64, error) {
	var deleted int64
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var err error
		deleted, err = sqlc.New(db).DeleteOldAuthRateLimits(ctx, timestamptz(now))
		return err
	})
	return deleted, err
}

func (s *Store) BootstrapAdmin(ctx context.Context, userID, email, passwordHash string, now time.Time) (string, bool, error) {
	newUserUUID, err := parseUUID(userID)
	if err != nil {
		return "", false, err
	}
	var actualUserID string
	created := false
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if err := queries.LockAdminBootstrapEmail(ctx, email); err != nil {
			return err
		}
		existing, err := queries.GetCredentialByEmail(ctx, email)
		if err == nil {
			isAdmin, adminErr := queries.HasAdminUser(ctx, existing.AuthUserID)
			if adminErr != nil {
				return adminErr
			}
			if existing.Kind != string(auth.UserKindAdmin) || !isAdmin {
				return auth.ErrAdminEmailInUse
			}
			actualUserID = formatUUID(existing.AuthUserID)
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := queries.CreateAuthUser(ctx, sqlc.CreateAuthUserParams{
			ID: newUserUUID, Kind: string(auth.UserKindAdmin), CreatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
		if err := queries.CreateAuthCredential(ctx, sqlc.CreateAuthCredentialParams{
			AuthUserID: newUserUUID, EmailNormalized: email, PasswordHash: passwordHash, CreatedAt: timestamptz(now),
		}); err != nil {
			if errors.Is(classifyCredentialWriteError(err), auth.ErrEmailInUse) {
				return auth.ErrAdminEmailInUse
			}
			return err
		}
		if err := queries.CreateAdminUser(ctx, sqlc.CreateAdminUserParams{
			AuthUserID: newUserUUID, CreatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
		actualUserID = userID
		created = true
		return nil
	})
	if err != nil {
		return "", false, err
	}
	return actualUserID, created, nil
}

func (s *Store) FindAdminCredential(ctx context.Context, email string) (auth.Credential, error) {
	var credential auth.Credential
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, err := sqlc.New(db).GetAdminCredentialByEmail(ctx, email)
		if err != nil {
			return err
		}
		credential = auth.Credential{
			Actor:        auth.Actor{AuthUserID: formatUUID(row.AuthUserID), Kind: auth.UserKind(row.Kind)},
			PasswordHash: row.PasswordHash,
			Disabled:     row.DisabledAt.Valid,
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Credential{}, auth.ErrCredentialNotFound
	}
	return credential, err
}

func (s *Store) CreateAdminLoginSession(
	ctx context.Context,
	userID, sessionID string,
	tokenHash, previousTokenHash []byte,
	passwordHash string,
	now, expiresAt time.Time,
) error {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return err
	}
	sessionUUID, err := parseUUID(sessionID)
	if err != nil {
		return err
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if passwordHash != "" {
			if err := queries.UpdateAuthCredentialPasswordHash(ctx, sqlc.UpdateAuthCredentialPasswordHashParams{
				AuthUserID: userUUID, PasswordHash: passwordHash, PasswordUpdatedAt: timestamptz(now),
			}); err != nil {
				return err
			}
		}
		if len(previousTokenHash) != 0 {
			if _, err := queries.RevokeAuthSessionByTokenHash(ctx, sqlc.RevokeAuthSessionByTokenHashParams{
				TokenHash: previousTokenHash, RevokedAt: timestamptz(now),
			}); err != nil {
				return err
			}
		}
		created, err := queries.CreateAuthSessionForEnabledAdminUser(ctx, sqlc.CreateAuthSessionForEnabledAdminUserParams{
			ID: sessionUUID, ID_2: userUUID, TokenHash: tokenHash,
			CreatedAt: timestamptz(now), ExpiresAt: timestamptz(expiresAt),
		})
		if err != nil {
			return err
		}
		if created != 1 {
			return auth.ErrInvalidCredentials
		}
		return nil
	})
	return err
}

func (s *Store) RecoverAdmin(ctx context.Context, email, passwordHash string, now time.Time) (string, int64, error) {
	var userID string
	var revokedCount int64
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		locked, err := queries.LockAdminByEmailForRecovery(ctx, email)
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrAdminNotFound
		}
		if err != nil {
			return err
		}
		userID = formatUUID(locked)
		if err := queries.UpdateAuthCredentialPasswordHash(ctx, sqlc.UpdateAuthCredentialPasswordHashParams{
			AuthUserID: locked, PasswordHash: passwordHash, PasswordUpdatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
		revokedCount, err = queries.RevokeAuthSessionsForUser(ctx, sqlc.RevokeAuthSessionsForUserParams{
			AuthUserID: locked, RevokedAt: timestamptz(now),
		})
		return err
	})
	if err != nil {
		return "", 0, err
	}
	return userID, revokedCount, nil
}

func (s *Store) IsAdmin(ctx context.Context, userID string) (bool, error) {
	userUUID, err := parseUUID(userID)
	if err != nil {
		return false, err
	}
	var isAdmin bool
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var queryErr error
		isAdmin, queryErr = sqlc.New(db).IsAdminAuthUser(ctx, userUUID)
		return queryErr
	})
	return isAdmin, err
}

func (s *Store) CountAdminLoginAttempt(ctx context.Context, ipSubject string) (auth.LoginRateResult, error) {
	var result auth.LoginRateResult
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		row, err := sqlc.New(db).UpsertAdminLoginRateLimit(ctx, ipSubject)
		if err != nil {
			return err
		}
		if row.Count > auth.AdminLoginLimit {
			result.Limited = true
			result.RetryAfter = time.Duration(row.RetryAfterSeconds) * time.Second
		}
		return nil
	})
	return result, err
}

func classifyCredentialWriteError(err error) error {
	if err == nil {
		return nil
	}
	var postgresErr *pgconn.PgError
	if errors.As(err, &postgresErr) && postgresErr.Code == "23505" &&
		(postgresErr.ConstraintName == "auth_credential_email_normalized_key" ||
			postgresErr.ConstraintName == "auth_credential_email_normalized_uidx") {
		return auth.ErrEmailInUse
	}
	return err
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
