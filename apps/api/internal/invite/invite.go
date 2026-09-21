// Package invite owns initial invitation issuance, inspection, and claim.
package invite

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"
)

var (
	ErrForbidden           = errors.New("initial invitation is not available to this member")
	ErrUnavailable         = errors.New("initial invitation is unavailable")
	ErrPairClaimed         = errors.New("Pair is already claimed")
	ErrDuplicatePair       = errors.New("participants already share an active Pair")
	ErrSelfClaim           = errors.New("participant cannot claim their own Pair")
	ErrParticipantRequired = errors.New("Participant is required")
)

const Lifetime = 7 * 24 * time.Hour

type Landing struct {
	PairID             string
	InviterDisplayName string
	RelationshipType   string
	IntendedPersonName *string
	ExpiresAt          time.Time
}

type Issued struct {
	Token     string
	ExpiresAt time.Time
	State     string
}
type Claimed struct {
	PairID          string
	MembershipEraID string
}

type Store interface {
	GetLanding(context.Context, [32]byte) (*Landing, error)
	Status(context.Context, string, string) (*time.Time, error)
	Issue(context.Context, string, string, bool) (Issued, error)
	Revoke(context.Context, string, string) error
	Claim(context.Context, [32]byte, string) (Claimed, error)
}

type Service struct {
	store Store
}

func NewService(store Store) *Service { return &Service{store: store} }

func (s *Service) Preview(ctx context.Context, token string) (*Landing, error) {
	if token == "" {
		return nil, nil
	}
	return s.store.GetLanding(ctx, hash(token))
}
func (s *Service) Status(ctx context.Context, participantID, pairID string) (*time.Time, error) {
	return s.store.Status(ctx, participantID, pairID)
}
func (s *Service) Issue(ctx context.Context, participantID, pairID string) (Issued, error) {
	return s.store.Issue(ctx, participantID, pairID, false)
}
func (s *Service) Replace(ctx context.Context, participantID, pairID string) (Issued, error) {
	return s.store.Issue(ctx, participantID, pairID, true)
}
func (s *Service) Revoke(ctx context.Context, participantID, pairID string) error {
	return s.store.Revoke(ctx, participantID, pairID)
}
func (s *Service) Claim(ctx context.Context, token, participantID string) (Claimed, error) {
	if participantID == "" {
		return Claimed{}, ErrParticipantRequired
	}
	if token == "" {
		return Claimed{}, ErrUnavailable
	}
	return s.store.Claim(ctx, hash(token), participantID)
}
func hash(token string) [32]byte { return sha256.Sum256([]byte(token)) }
func NewToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
