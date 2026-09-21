// Package auth owns authentication identity, credential, and session rules.
// It has no HTTP, PostgreSQL, or Closer Participant dependencies.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"
)

const (
	SessionTokenBytes   = 32
	SessionCookieName   = "closer_session"
	SessionIdleTTL      = 7 * 24 * time.Hour
	SessionAbsoluteTTL  = 30 * 24 * time.Hour
	SessionRenewAfter   = 24 * time.Hour
	SessionCleanupEvery = 24 * time.Hour
	SessionCleanupBatch = 500
)

type UserKind string

const (
	UserKindAnonymous  UserKind = "anonymous"
	UserKindRegistered UserKind = "registered"
	UserKindAdmin      UserKind = "admin"
)

var ErrUnauthenticated = errors.New("authentication required")

type Actor struct {
	AuthUserID string   `json:"authUserId"`
	Kind       UserKind `json:"kind"`
}

type SessionState struct {
	Actor      Actor
	SessionID  string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastUsedAt time.Time
}

type AnonymousSession struct {
	Actor     Actor
	Token     string
	ExpiresAt time.Time
}

type SessionStore interface {
	CreateAnonymous(context.Context, string, string, []byte, time.Time, time.Time) error
	FindSession(context.Context, []byte, time.Time) (SessionState, error)
	RenewSession(context.Context, string, time.Time, time.Time) error
	RevokeSession(context.Context, []byte, time.Time) error
	DeleteExpiredSessions(context.Context, time.Time, int32) (int64, error)
}

type Service struct {
	store       SessionStore
	credentials CredentialStore
	admin       AdminStore
	hasher      PasswordHasher
	now         func() time.Time
}

func NewService(store SessionStore) *Service {
	return NewServiceWithClock(store, time.Now)
}

// NewServiceWithClock is a deterministic seam for expiry and boundary tests.
func NewServiceWithClock(store SessionStore, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, now: now}
}

func NewServiceWithCredentials(store SessionStore, credentials CredentialStore, hasher PasswordHasher) *Service {
	return NewServiceWithCredentialsAndClock(store, credentials, hasher, time.Now)
}

func NewServiceWithCredentialsAndClock(store SessionStore, credentials CredentialStore, hasher PasswordHasher, now func() time.Time) *Service {
	service := NewServiceWithClock(store, now)
	service.credentials = credentials
	if adminStore, ok := credentials.(AdminStore); ok {
		service.admin = adminStore
	}
	if hasher == nil {
		hasher = Argon2idHasher{}
	}
	service.hasher = hasher
	return service
}

func (s *Service) CreateAnonymous(ctx context.Context) (AnonymousSession, error) {
	now := s.now().UTC()
	userID, err := NewID()
	if err != nil {
		return AnonymousSession{}, err
	}
	sessionID, err := NewID()
	if err != nil {
		return AnonymousSession{}, err
	}
	token, err := NewSessionToken(rand.Reader)
	if err != nil {
		return AnonymousSession{}, err
	}
	hash := HashSessionToken(token)
	expiresAt := now.Add(SessionIdleTTL)
	if err := s.store.CreateAnonymous(ctx, userID, sessionID, hash[:], now, expiresAt); err != nil {
		return AnonymousSession{}, err
	}
	return AnonymousSession{
		Actor:     Actor{AuthUserID: userID, Kind: UserKindAnonymous},
		Token:     token,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *Service) ResolveSession(ctx context.Context, token string) (Actor, error) {
	state, err := s.findSession(ctx, token)
	if err != nil {
		return Actor{}, err
	}
	return state.Actor, nil
}

// RenewSession is for authenticated state-changing requests. Safe reads such
// as GET /me never touch session state or refresh the cookie.
func (s *Service) RenewSession(ctx context.Context, token string) (Actor, *time.Time, error) {
	state, err := s.findSession(ctx, token)
	if err != nil {
		return Actor{}, nil, err
	}
	now := s.now().UTC()
	expiresAt, shouldRenew := sessionRenewalExpiry(state, now)
	if !shouldRenew {
		return state.Actor, nil, nil
	}
	if err := s.store.RenewSession(ctx, state.SessionID, now, expiresAt); err != nil {
		return Actor{}, nil, err
	}
	return state.Actor, &expiresAt, nil
}

func (s *Service) findSession(ctx context.Context, token string) (SessionState, error) {
	hash, err := ParseAndHashSessionToken(token)
	if err != nil {
		return SessionState{}, ErrUnauthenticated
	}
	now := s.now().UTC()
	state, err := s.store.FindSession(ctx, hash[:], now)
	if err != nil {
		return SessionState{}, err
	}
	if state.Actor.AuthUserID == "" || state.SessionID == "" || state.ExpiresAt.IsZero() {
		return SessionState{}, ErrUnauthenticated
	}
	return state, nil
}

func sessionRenewalExpiry(state SessionState, now time.Time) (time.Time, bool) {
	if now.Sub(state.LastUsedAt) < SessionRenewAfter {
		return time.Time{}, false
	}
	expiresAt := now.Add(SessionIdleTTL)
	absoluteExpiry := state.CreatedAt.Add(SessionAbsoluteTTL)
	if expiresAt.After(absoluteExpiry) {
		expiresAt = absoluteExpiry
	}
	if !expiresAt.After(state.ExpiresAt) {
		return time.Time{}, false
	}
	return expiresAt, true
}

func (s *Service) RevokeSession(ctx context.Context, token string) error {
	hash, err := ParseAndHashSessionToken(token)
	if err != nil {
		return nil
	}
	return s.store.RevokeSession(ctx, hash[:], s.now().UTC())
}

func (s *Service) CleanupExpiredSessions(ctx context.Context) (int64, error) {
	return s.store.DeleteExpiredSessions(ctx, s.now().UTC(), SessionCleanupBatch)
}

func NewSessionToken(reader io.Reader) (string, error) {
	if reader == nil {
		reader = rand.Reader
	}
	var token [SessionTokenBytes]byte
	if _, err := io.ReadFull(reader, token[:]); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(token[:]), nil
}

func HashSessionToken(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}

func ParseAndHashSessionToken(token string) ([sha256.Size]byte, error) {
	var empty [sha256.Size]byte
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != SessionTokenBytes || base64.RawURLEncoding.EncodeToString(decoded) != token {
		return empty, ErrUnauthenticated
	}
	return sha256.Sum256([]byte(token)), nil
}

func NewID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", fmt.Errorf("generate authentication ID: %w", err)
	}
	id[6] = id[6]&0x0f | 0x40
	id[8] = id[8]&0x3f | 0x80
	encoded := make([]byte, 36)
	hex.Encode(encoded[0:8], id[0:4])
	encoded[8] = '-'
	hex.Encode(encoded[9:13], id[4:6])
	encoded[13] = '-'
	hex.Encode(encoded[14:18], id[6:8])
	encoded[18] = '-'
	hex.Encode(encoded[19:23], id[8:10])
	encoded[23] = '-'
	hex.Encode(encoded[24:36], id[10:16])
	return string(encoded), nil
}
