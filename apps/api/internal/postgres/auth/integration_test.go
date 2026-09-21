package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"testing"
	"time"

	appauth "github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/jackc/pgx/v5/pgtype"
)

func openAuthTestPool(t *testing.T) *postgres.Pool {
	t.Helper()
	if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
		t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL auth integration checks")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestAnonymousSessionPersistsOnlyHashAndSupportsLookupRevocationAndExpiry(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	service := appauth.NewServiceWithClock(store, func() time.Time { return now })

	created, err := service.CreateAnonymous(context.Background())
	if err != nil {
		t.Fatalf("CreateAnonymous() error = %v", err)
	}
	actor, err := service.ResolveSession(context.Background(), created.Token)
	if err != nil || actor != created.Actor {
		t.Fatalf("ResolveSession() actor = %+v, error = %v", actor, err)
	}

	userID, err := parseUUID(created.Actor.AuthUserID)
	if err != nil {
		t.Fatal(err)
	}
	var hashes [][]byte
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		var queryErr error
		hashes, queryErr = sqlc.New(db).ListAuthSessionTokenHashes(context.Background(), userID)
		return queryErr
	})
	if err != nil {
		t.Fatalf("read stored session hashes: %v", err)
	}
	wantHash := appauth.HashSessionToken(created.Token)
	if len(hashes) != 1 || len(hashes[0]) != sha256.Size || string(hashes[0]) != string(wantHash[:]) {
		t.Fatal("database did not contain exactly SHA-256(raw session token)")
	}
	if string(hashes[0]) == created.Token {
		t.Fatal("raw session token was persisted")
	}

	if err := service.RevokeSession(context.Background(), created.Token); err != nil {
		t.Fatalf("RevokeSession() error = %v", err)
	}
	if _, err := service.ResolveSession(context.Background(), created.Token); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v, want unauthenticated", err)
	}

	oldUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	oldSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	oldToken, err := appauth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	oldHash := appauth.HashSessionToken(oldToken)
	createdAt := now.Add(-appauth.SessionAbsoluteTTL - time.Hour)
	if err := store.CreateAnonymous(context.Background(), oldUserID, oldSessionID, oldHash[:], createdAt, createdAt.Add(appauth.SessionIdleTTL)); err != nil {
		t.Fatalf("insert expired-session fixture: %v", err)
	}
	if _, err := service.ResolveSession(context.Background(), oldToken); !errors.Is(err, appauth.ErrUnauthenticated) {
		t.Fatalf("expired session error = %v, want unauthenticated", err)
	}
}

func TestAuthSessionForeignKeyAndTokenHashUniqueness(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)

	missingUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	sessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	var foreignKeyErr error
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, queryErr := sqlc.New(db).CreateAuthSession(context.Background(), sqlc.CreateAuthSessionParams{
			ID:         mustUUID(t, sessionID),
			AuthUserID: mustUUID(t, missingUserID),
			TokenHash:  make([]byte, sha256.Size),
			CreatedAt:  timestamptz(now),
			ExpiresAt:  timestamptz(now.Add(time.Hour)),
		})
		foreignKeyErr = queryErr
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if foreignKeyErr == nil {
		t.Fatal("auth_session accepted a missing auth_user foreign key")
	}

	created, err := appauth.NewServiceWithClock(store, func() time.Time { return now }).CreateAnonymous(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	firstUserID, err := parseUUID(created.Actor.AuthUserID)
	if err != nil {
		t.Fatal(err)
	}
	var originalHash []byte
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		hashes, queryErr := sqlc.New(db).ListAuthSessionTokenHashes(context.Background(), firstUserID)
		if queryErr == nil && len(hashes) > 0 {
			originalHash = hashes[0]
		}
		return queryErr
	})
	if err != nil || len(originalHash) != sha256.Size {
		t.Fatalf("read original token hash: %v", err)
	}

	secondUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	secondSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAnonymous(context.Background(), secondUserID, secondSessionID, originalHash, now, now.Add(appauth.SessionIdleTTL)); err == nil {
		t.Fatal("auth_session accepted a duplicate token hash")
	}
}

func TestExpiredSessionCleanupIsBoundedAndRetainsActiveSessions(t *testing.T) {
	pool := openAuthTestPool(t)
	store := NewStore(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	service := appauth.NewServiceWithClock(store, func() time.Time { return now })

	active, err := service.CreateAnonymous(context.Background())
	if err != nil {
		t.Fatalf("create active session: %v", err)
	}
	expiredUserID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	expiredSessionID, err := appauth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	expiredToken, err := appauth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	expiredHash := appauth.HashSessionToken(expiredToken)
	createdAt := now.Add(-appauth.SessionAbsoluteTTL - time.Hour)
	if err := store.CreateAnonymous(context.Background(), expiredUserID, expiredSessionID, expiredHash[:], createdAt, createdAt.Add(appauth.SessionIdleTTL)); err != nil {
		t.Fatalf("create expired fixture: %v", err)
	}

	deleted, err := service.CleanupExpiredSessions(context.Background())
	if err != nil {
		t.Fatalf("CleanupExpiredSessions() error = %v", err)
	}
	if deleted < 1 || deleted > appauth.SessionCleanupBatch {
		t.Fatalf("deleted session count = %d, want 1..%d", deleted, appauth.SessionCleanupBatch)
	}
	if _, err := service.ResolveSession(context.Background(), active.Token); err != nil {
		t.Fatalf("cleanup removed an active session: %v", err)
	}
	var expiredExists bool
	err = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		var queryErr error
		expiredExists, queryErr = sqlc.New(db).HasAuthSession(context.Background(), expiredHash[:])
		return queryErr
	})
	if err != nil || expiredExists {
		t.Fatalf("expired session exists after cleanup = %t, error = %v", expiredExists, err)
	}
}

func mustUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	result, err := parseUUID(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
