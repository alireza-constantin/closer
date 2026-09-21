package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/cases"
)

const (
	MinPasswordBytes           = 8
	MaxPasswordBytes           = 128
	Argon2Version              = 19
	Argon2MemoryKiB     uint32 = 64 * 1024
	Argon2Iterations    uint32 = 3
	Argon2Parallelism   uint8  = 1
	Argon2SaltBytes            = 16
	Argon2KeyBytes             = 32
	ConsumerLoginLimit         = 10
	ConsumerLoginWindow        = time.Minute
	Argon2MaxConcurrent        = 2 // At the frozen memory cost, bounds concurrent work to 128 MiB.
)

var argon2WorkSlots = make(chan struct{}, Argon2MaxConcurrent)

var (
	ErrEmailInUse         = errors.New("email is already in use")
	ErrCannotUpgrade      = errors.New("current identity cannot be upgraded")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrCredentialNotFound = errors.New("credential not found")
	ErrInvalidInput       = errors.New("invalid authentication input")
)

type Credential struct {
	Actor        Actor
	PasswordHash string
	Disabled     bool
}

type LoginRateResult struct {
	Limited    bool
	RetryAfter time.Duration
}

// CredentialStore keeps each multi-row auth transition inside one adapter
// transaction. Implementations must never persist raw passwords, session
// tokens, IP addresses, or unnormalized email values.
type CredentialStore interface {
	Register(context.Context, string, string, string, string, []byte, time.Time, time.Time) error
	Upgrade(context.Context, string, string, string, time.Time) error
	FindCredential(context.Context, string) (Credential, error)
	CreateLoginSession(context.Context, string, string, []byte, []byte, string, time.Time, time.Time) error
	RevokeAllSessions(context.Context, string, time.Time) error
	CountConsumerLoginAttempt(context.Context, string, string) (LoginRateResult, error)
	DeleteOldRateLimits(context.Context, time.Time) (int64, error)
}

type PasswordHasher interface {
	Hash(context.Context, string) (string, error)
	Verify(context.Context, string, string) (bool, error)
	NeedsRehash(encoded string) bool
}

type Argon2idHasher struct{ Random io.Reader }

func (h Argon2idHasher) Hash(ctx context.Context, password string) (string, error) {
	if !validPasswordForCreation(password) {
		return "", ErrInvalidInput
	}
	if err := acquireArgon2Slot(ctx); err != nil {
		return "", err
	}
	defer releaseArgon2Slot()
	reader := h.Random
	if reader == nil {
		reader = rand.Reader
	}
	salt := make([]byte, Argon2SaltBytes)
	if _, err := io.ReadFull(reader, salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	derived := argon2.IDKey([]byte(password), salt, Argon2Iterations, Argon2MemoryKiB, Argon2Parallelism, Argon2KeyBytes)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		Argon2Version,
		Argon2MemoryKiB,
		Argon2Iterations,
		Argon2Parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(derived),
	), nil
}

func (Argon2idHasher) Verify(ctx context.Context, encoded, password string) (bool, error) {
	validPassword := len(password) <= MaxPasswordBytes && utf8.ValidString(password)
	if !validPassword {
		password = ""
	}
	parameters, salt, expected, err := parseArgon2Hash(encoded)
	if err != nil {
		if acquireErr := acquireArgon2Slot(ctx); acquireErr != nil {
			return false, acquireErr
		}
		defer releaseArgon2Slot()
		_ = argon2.IDKey([]byte(password), []byte("Closer invalid hash salt"), Argon2Iterations, Argon2MemoryKiB, Argon2Parallelism, Argon2KeyBytes)
		return false, nil
	}
	if err := acquireArgon2Slot(ctx); err != nil {
		return false, err
	}
	defer releaseArgon2Slot()
	actual := argon2.IDKey([]byte(password), salt, parameters.iterations, parameters.memoryKiB, parameters.parallelism, uint32(len(expected)))
	matched := subtle.ConstantTimeCompare(actual, expected) == 1
	return validPassword && matched, nil
}

func acquireArgon2Slot(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case argon2WorkSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func releaseArgon2Slot() { <-argon2WorkSlots }

func (Argon2idHasher) NeedsRehash(encoded string) bool {
	parameters, salt, expected, err := parseArgon2Hash(encoded)
	return err != nil || parameters.memoryKiB != Argon2MemoryKiB ||
		parameters.iterations != Argon2Iterations || parameters.parallelism != Argon2Parallelism ||
		len(salt) != Argon2SaltBytes || len(expected) != Argon2KeyBytes
}

type argon2Parameters struct {
	memoryKiB   uint32
	iterations  uint32
	parallelism uint8
}

func parseArgon2Hash(encoded string) (argon2Parameters, []byte, []byte, error) {
	var parameters argon2Parameters
	if len(encoded) == 0 || len(encoded) > 512 {
		return parameters, nil, nil, errors.New("invalid encoded password hash length")
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return parameters, nil, nil, errors.New("invalid Argon2id encoding")
	}
	var memory, iterations, parallelism uint64
	seen := make(map[string]struct{}, 3)
	for _, value := range strings.Split(parts[3], ",") {
		key, raw, ok := strings.Cut(value, "=")
		if !ok {
			return parameters, nil, nil, errors.New("invalid Argon2id parameters")
		}
		if _, exists := seen[key]; exists {
			return parameters, nil, nil, errors.New("duplicate Argon2id parameter")
		}
		seen[key] = struct{}{}
		parsed, err := strconv.ParseUint(raw, 10, 32)
		if err != nil {
			return parameters, nil, nil, errors.New("invalid Argon2id parameters")
		}
		switch key {
		case "m":
			memory = parsed
		case "t":
			iterations = parsed
		case "p":
			parallelism = parsed
		default:
			return parameters, nil, nil, errors.New("unknown Argon2id parameter")
		}
	}
	if len(seen) != 3 {
		return parameters, nil, nil, errors.New("incomplete Argon2id parameters")
	}
	if memory < 8*1024 || memory > 256*1024 || iterations == 0 || iterations > 10 || parallelism == 0 || parallelism > 4 {
		return parameters, nil, nil, errors.New("Argon2id parameters outside accepted bounds")
	}
	parameters = argon2Parameters{memoryKiB: uint32(memory), iterations: uint32(iterations), parallelism: uint8(parallelism)}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 || base64.RawStdEncoding.EncodeToString(salt) != parts[4] {
		return argon2Parameters{}, nil, nil, errors.New("invalid Argon2id salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != Argon2KeyBytes || base64.RawStdEncoding.EncodeToString(expected) != parts[5] {
		return argon2Parameters{}, nil, nil, errors.New("invalid Argon2id key")
	}
	return parameters, salt, expected, nil
}

func NormalizeEmail(email string) (string, error) {
	trimmed := strings.TrimSpace(email)
	if trimmed == "" || len(trimmed) > 320 || !utf8.ValidString(trimmed) || strings.ContainsAny(trimmed, "\r\n\t ") {
		return "", ErrInvalidInput
	}
	address, err := mail.ParseAddress(trimmed)
	if err != nil || address.Name != "" || address.Address != trimmed || !strings.Contains(trimmed, "@") {
		return "", ErrInvalidInput
	}
	normalized := cases.Fold().String(trimmed)
	if normalized == "" || len(normalized) > 320 {
		return "", ErrInvalidInput
	}
	return normalized, nil
}

func validPasswordForCreation(password string) bool {
	return utf8.ValidString(password) && len(password) >= MinPasswordBytes && len(password) <= MaxPasswordBytes
}

type SessionGrant struct {
	Actor     Actor
	Token     string
	ExpiresAt time.Time
}

type RateLimitedError struct{ RetryAfter time.Duration }

func (e RateLimitedError) Error() string { return "authentication rate limit exceeded" }

func (s *Service) Register(ctx context.Context, email, password string) (SessionGrant, error) {
	if s.credentials == nil || s.hasher == nil {
		return SessionGrant{}, errors.New("credential authentication is not configured")
	}
	normalized, err := NormalizeEmail(email)
	if err != nil || !validPasswordForCreation(password) {
		return SessionGrant{}, ErrInvalidInput
	}
	passwordHash, err := s.hasher.Hash(ctx, password)
	if err != nil {
		return SessionGrant{}, err
	}
	userID, err := NewID()
	if err != nil {
		return SessionGrant{}, err
	}
	sessionID, err := NewID()
	if err != nil {
		return SessionGrant{}, err
	}
	token, err := NewSessionToken(rand.Reader)
	if err != nil {
		return SessionGrant{}, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(SessionIdleTTL)
	tokenHash := HashSessionToken(token)
	if err := s.credentials.Register(ctx, userID, sessionID, normalized, passwordHash, tokenHash[:], now, expiresAt); err != nil {
		return SessionGrant{}, err
	}
	return SessionGrant{Actor: Actor{AuthUserID: userID, Kind: UserKindRegistered}, Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Service) Upgrade(ctx context.Context, currentToken, email, password string) (Actor, error) {
	if s.credentials == nil || s.hasher == nil {
		return Actor{}, errors.New("credential authentication is not configured")
	}
	actor, err := s.ResolveSession(ctx, currentToken)
	if err != nil {
		return Actor{}, err
	}
	if actor.Kind != UserKindAnonymous {
		return Actor{}, ErrCannotUpgrade
	}
	normalized, err := NormalizeEmail(email)
	if err != nil || !validPasswordForCreation(password) {
		return Actor{}, ErrInvalidInput
	}
	passwordHash, err := s.hasher.Hash(ctx, password)
	if err != nil {
		return Actor{}, err
	}
	if err := s.credentials.Upgrade(ctx, actor.AuthUserID, normalized, passwordHash, s.now().UTC()); err != nil {
		return Actor{}, err
	}
	actor.Kind = UserKindRegistered
	return actor, nil
}

func (s *Service) Login(ctx context.Context, email, password, clientIP, currentToken string) (SessionGrant, error) {
	if s.credentials == nil || s.hasher == nil {
		return SessionGrant{}, errors.New("credential authentication is not configured")
	}
	normalized, normalizeErr := NormalizeEmail(email)
	if normalizeErr != nil {
		normalized = cases.Fold().String(strings.TrimSpace(email))
	}
	if len(normalized) > 320 {
		normalized = normalized[:320]
	}
	now := s.now().UTC()
	ipSubject := subjectHash("consumer-login-ip", clientIP)
	emailSubject := subjectHash("consumer-login-email", normalized)
	limit, err := s.credentials.CountConsumerLoginAttempt(ctx, ipSubject, emailSubject)
	if err != nil {
		return SessionGrant{}, err
	}
	if limit.Limited {
		return SessionGrant{}, RateLimitedError{RetryAfter: limit.RetryAfter}
	}
	credential, findErr := s.credentials.FindCredential(ctx, normalized)
	if findErr != nil && !errors.Is(findErr, ErrCredentialNotFound) {
		return SessionGrant{}, findErr
	}
	if errors.Is(findErr, ErrCredentialNotFound) {
		// Match the configured password hash cost when an email has no credential.
		if _, err := s.hasher.Hash(ctx, "Closer invalid login timing work"); err != nil {
			return SessionGrant{}, err
		}
		return SessionGrant{}, ErrInvalidCredentials
	}
	valid, verifyErr := s.hasher.Verify(ctx, credential.PasswordHash, password)
	if verifyErr != nil {
		return SessionGrant{}, verifyErr
	}
	if !valid || credential.Disabled || credential.Actor.Kind != UserKindRegistered || normalizeErr != nil {
		return SessionGrant{}, ErrInvalidCredentials
	}
	var replacementHash string
	if s.hasher.NeedsRehash(credential.PasswordHash) {
		replacementHash, err = s.hasher.Hash(ctx, password)
		if err != nil {
			return SessionGrant{}, err
		}
	}
	sessionID, err := NewID()
	if err != nil {
		return SessionGrant{}, err
	}
	token, err := NewSessionToken(rand.Reader)
	if err != nil {
		return SessionGrant{}, err
	}
	newHash := HashSessionToken(token)
	var previousHash []byte
	if hash, hashErr := ParseAndHashSessionToken(currentToken); hashErr == nil {
		previousHash = hash[:]
	}
	expiresAt := now.Add(SessionIdleTTL)
	if err := s.credentials.CreateLoginSession(ctx, credential.Actor.AuthUserID, sessionID, newHash[:], previousHash, replacementHash, now, expiresAt); err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			return SessionGrant{}, ErrInvalidCredentials
		}
		return SessionGrant{}, err
	}
	return SessionGrant{Actor: credential.Actor, Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Service) RevokeAllSessions(ctx context.Context, actor Actor) error {
	if s.credentials == nil {
		return errors.New("credential authentication is not configured")
	}
	return s.credentials.RevokeAllSessions(ctx, actor.AuthUserID, s.now().UTC())
}

func (s *Service) CleanupRateLimits(ctx context.Context) (int64, error) {
	if s.credentials == nil {
		return 0, nil
	}
	return s.credentials.DeleteOldRateLimits(ctx, s.now().UTC())
}

func subjectHash(scope, subject string) string {
	hash := sha256.Sum256([]byte(scope + ":" + subject))
	return fmt.Sprintf("%x", hash[:])
}
