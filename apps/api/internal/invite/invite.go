// Package invite owns initial invitation issuance, inspection, and claim.
package invite

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

var (
	ErrForbidden           = errors.New("initial invitation is not available to this member")
	ErrUnavailable         = errors.New("initial invitation is unavailable")
	ErrPairClaimed         = errors.New("Pair is already claimed")
	ErrDuplicatePair       = errors.New("participants already share an active Pair")
	ErrSelfClaim           = errors.New("participant cannot claim their own Pair")
	ErrParticipantRequired = errors.New("Participant is required")
	ErrRejoinUnavailable   = errors.New("rejoin credential is unavailable")
	ErrDisplayNameInvalid  = errors.New("display name is invalid")
)

const Lifetime = 7 * 24 * time.Hour
const RejoinLifetime = 24 * time.Hour

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

type RejoinLanding struct {
	TargetSlot string
}

type RejoinIssued struct {
	Token                        string
	ExpiresAt                    time.Time
	TargetParticipantDisplayName string
}

type Rejoined struct {
	PairID          string
	MembershipEraID string
	ParticipantID   string
}

type Store interface {
	GetLanding(context.Context, [32]byte) (*Landing, error)
	Status(context.Context, string, string) (*time.Time, error)
	Issue(context.Context, string, string, bool) (Issued, error)
	Revoke(context.Context, string, string) error
	Claim(context.Context, [32]byte, string) (Claimed, error)
	GetRejoinLanding(context.Context, [32]byte) (*RejoinLanding, error)
	IssueRejoin(context.Context, string, string) (RejoinIssued, error)
	RevokeRejoin(context.Context, string, string) error
	Rejoin(context.Context, [32]byte, string, string) (Rejoined, error)
}

type Service struct {
	store     Store
	publisher realtime.Publisher
}

func NewService(store Store) *Service { return &Service{store: store} }

func NewServiceWithPublisher(store Store, publisher realtime.Publisher) *Service {
	return &Service{store: store, publisher: publisher}
}

func (s *Service) publishPairChanged(ctx context.Context, pairID string) {
	if s.publisher == nil || pairID == "" {
		return
	}
	// Realtime is an after-commit invalidation path. A temporary delivery
	// failure must never turn a committed invite or membership mutation into a
	// failed business operation; the consumer refetch/polling path recovers.
	_ = s.publisher.Publish(ctx, realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairChanged})
}

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
	result, err := s.store.Issue(ctx, participantID, pairID, false)
	if err == nil && result.State == "issued" {
		s.publishPairChanged(ctx, pairID)
	}
	return result, err
}
func (s *Service) Replace(ctx context.Context, participantID, pairID string) (Issued, error) {
	result, err := s.store.Issue(ctx, participantID, pairID, true)
	if err == nil {
		s.publishPairChanged(ctx, pairID)
	}
	return result, err
}
func (s *Service) Revoke(ctx context.Context, participantID, pairID string) error {
	err := s.store.Revoke(ctx, participantID, pairID)
	if err == nil {
		s.publishPairChanged(ctx, pairID)
	}
	return err
}
func (s *Service) Claim(ctx context.Context, token, participantID string) (Claimed, error) {
	if participantID == "" {
		return Claimed{}, ErrParticipantRequired
	}
	if token == "" {
		return Claimed{}, ErrUnavailable
	}
	result, err := s.store.Claim(ctx, hash(token), participantID)
	if err == nil {
		s.publishPairChanged(ctx, result.PairID)
	}
	return result, err
}

func (s *Service) RejoinPreview(ctx context.Context, token string) (*RejoinLanding, error) {
	if token == "" {
		return nil, nil
	}
	return s.store.GetRejoinLanding(ctx, hash(token))
}

func (s *Service) IssueRejoin(ctx context.Context, participantID, pairID string) (RejoinIssued, error) {
	result, err := s.store.IssueRejoin(ctx, participantID, pairID)
	if err == nil {
		s.publishPairChanged(ctx, pairID)
	}
	return result, err
}

func (s *Service) RevokeRejoin(ctx context.Context, participantID, pairID string) error {
	err := s.store.RevokeRejoin(ctx, participantID, pairID)
	if err == nil {
		s.publishPairChanged(ctx, pairID)
	}
	return err
}

func (s *Service) Rejoin(ctx context.Context, token, authUserID, rawDisplayName string) (Rejoined, error) {
	if token == "" || authUserID == "" {
		return Rejoined{}, ErrRejoinUnavailable
	}
	displayName := strings.TrimSpace(rawDisplayName)
	if units := len(utf16.Encode([]rune(displayName))); units < 1 || units > 40 {
		return Rejoined{}, ErrDisplayNameInvalid
	}
	result, err := s.store.Rejoin(ctx, hash(token), authUserID, displayName)
	if err != nil {
		return Rejoined{}, err
	}
	s.publishPairChanged(ctx, result.PairID)
	return result, nil
}
func hash(token string) [32]byte { return sha256.Sum256([]byte(token)) }
func NewToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
