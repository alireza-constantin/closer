package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestSessionTokenFormatEntropyAndHash(t *testing.T) {
	seen := make(map[string]struct{}, 1024)
	for range 1024 {
		token, err := NewSessionToken(nil)
		if err != nil {
			t.Fatalf("NewSessionToken() error = %v", err)
		}
		decoded, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || len(decoded) != SessionTokenBytes || len(token) != 43 {
			t.Fatalf("token format = %q, decoded length = %d, error = %v", token, len(decoded), err)
		}
		if strings.ContainsAny(token, "+/=") {
			t.Fatalf("token is not unpadded base64url: %q", token)
		}
		if _, duplicate := seen[token]; duplicate {
			t.Fatal("generated a duplicate session token")
		}
		seen[token] = struct{}{}

		first := HashSessionToken(token)
		second := HashSessionToken(token)
		if first != second || first == sha256.Sum256([]byte("different token")) {
			t.Fatal("session token hash is not deterministic")
		}
		if bytes.Equal(first[:], []byte(token)) {
			t.Fatal("stored token hash equals the raw session token")
		}
	}
}

func TestParseAndHashSessionTokenRejectsMalformedValues(t *testing.T) {
	good, err := NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := ParseAndHashSessionToken(good)
	if err != nil || hash != HashSessionToken(good) {
		t.Fatalf("ParseAndHashSessionToken() = %x, %v", hash, err)
	}
	for _, token := range []string{"", "short", good + "=", strings.Repeat("A", 44)} {
		if _, err := ParseAndHashSessionToken(token); err == nil {
			t.Fatalf("accepted malformed token %q", token)
		}
	}
}

func TestSessionRenewalPolicyUsesDailyTouchAndAbsoluteCeiling(t *testing.T) {
	created := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	state := SessionState{
		CreatedAt:  created,
		ExpiresAt:  created.Add(SessionIdleTTL),
		LastUsedAt: created,
	}
	if _, ok := sessionRenewalExpiry(state, created.Add(SessionRenewAfter-time.Nanosecond)); ok {
		t.Fatal("renewed before the 24-hour boundary")
	}
	got, ok := sessionRenewalExpiry(state, created.Add(SessionRenewAfter))
	want := created.Add(SessionRenewAfter + SessionIdleTTL)
	if !ok || !got.Equal(want) {
		t.Fatalf("renewal expiry = %s, %t; want %s", got, ok, want)
	}

	state.LastUsedAt = created.Add(29 * 24 * time.Hour)
	state.ExpiresAt = created.Add(30 * 24 * time.Hour)
	got, ok = sessionRenewalExpiry(state, created.Add(30*24*time.Hour-time.Minute))
	if ok || !got.IsZero() {
		t.Fatalf("renewed beyond absolute ceiling: %s, %t", got, ok)
	}
}

func TestNewIDProducesUUIDv4(t *testing.T) {
	id, err := NewID()
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != 36 || id[14] != '4' || !strings.ContainsRune("89ab", rune(id[19])) {
		t.Fatalf("ID = %q, want a UUID v4", id)
	}
}

type fakeSessionStore struct {
	state        SessionState
	createdID    string
	createdSid   string
	hash         []byte
	revoked      bool
	renewedTo    time.Time
	cleanupLimit int32
}

func (store *fakeSessionStore) CreateAnonymous(_ context.Context, userID, sessionID string, tokenHash []byte, _, _ time.Time) error {
	store.createdID = userID
	store.createdSid = sessionID
	store.hash = append([]byte(nil), tokenHash...)
	return nil
}

func (store *fakeSessionStore) FindSession(_ context.Context, _ []byte, _ time.Time) (SessionState, error) {
	return store.state, nil
}

func (store *fakeSessionStore) RenewSession(_ context.Context, _ string, _ time.Time, expiresAt time.Time) error {
	store.renewedTo = expiresAt
	return nil
}

func (store *fakeSessionStore) RevokeSession(_ context.Context, _ []byte, _ time.Time) error {
	store.revoked = true
	return nil
}

func (store *fakeSessionStore) DeleteExpiredSessions(_ context.Context, _ time.Time, limit int32) (int64, error) {
	store.cleanupLimit = limit
	return 0, nil
}

func TestCreateAnonymousStoresHashAndKeepsTokenForCookieOnly(t *testing.T) {
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	store := &fakeSessionStore{}
	service := NewServiceWithClock(store, func() time.Time { return now })
	created, err := service.CreateAnonymous(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if created.Actor.Kind != UserKindAnonymous || created.Actor.AuthUserID != store.createdID {
		t.Fatalf("created actor = %+v, persisted user = %q", created.Actor, store.createdID)
	}
	if len(store.hash) != sha256.Size || bytes.Equal(store.hash, []byte(created.Token)) {
		t.Fatal("store did not receive only the SHA-256 token hash")
	}
	if got := HashSessionToken(created.Token); !bytes.Equal(store.hash, got[:]) {
		t.Fatal("stored value is not SHA-256(raw token)")
	}
	if !created.ExpiresAt.Equal(now.Add(SessionIdleTTL)) {
		t.Fatalf("session expiry = %s", created.ExpiresAt)
	}
}

func TestRevokeInvalidTokenDoesNotCallStore(t *testing.T) {
	store := &fakeSessionStore{}
	service := NewService(store)
	if err := service.RevokeSession(context.Background(), "invalid"); err != nil {
		t.Fatal(err)
	}
	if store.revoked {
		t.Fatal("invalid cookie caused a database revocation lookup")
	}
}

func TestCleanupExpiredSessionsUsesTheFrozenBatchLimit(t *testing.T) {
	store := &fakeSessionStore{}
	service := NewService(store)
	if _, err := service.CleanupExpiredSessions(context.Background()); err != nil {
		t.Fatal(err)
	}
	if store.cleanupLimit != SessionCleanupBatch {
		t.Fatalf("cleanup limit = %d, want %d", store.cleanupLimit, SessionCleanupBatch)
	}
}
