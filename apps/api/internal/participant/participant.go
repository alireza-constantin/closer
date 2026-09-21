// Package participant owns the authenticated-user to Closer Participant link.
package participant

import (
	"context"
	"errors"
	"strings"
	"unicode/utf16"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
)

var (
	ErrDisplayNameInvalid = errors.New("display name is invalid")
	ErrAdminNotAllowed    = errors.New("Admin identities do not have Participants")
	ErrNotFound           = errors.New("Participant not found")
)

type Participant struct {
	ID          string
	AuthUserID  string
	DisplayName string
}

type Tx interface {
	GetByAuthUserID(context.Context, string) (Participant, error)
	Create(context.Context, string, string) (*Participant, error)
}

type Store interface {
	WithinTx(context.Context, func(Tx) error) error
	GetByAuthUserID(context.Context, string) (Participant, error)
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

// Resolve is read-only. Admin actors are intentionally never projected as a
// consumer Participant, even if a malformed database row exists.
func (s *Service) Resolve(ctx context.Context, actor auth.Actor) (*Participant, error) {
	if actor.Kind == auth.UserKindAdmin {
		return nil, nil
	}
	if actor.Kind != auth.UserKindAnonymous && actor.Kind != auth.UserKindRegistered {
		return nil, ErrAdminNotAllowed
	}
	participant, err := s.store.GetByAuthUserID(ctx, actor.AuthUserID)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &participant, nil
}

// Onboard explicitly creates a Participant for the authenticated consumer.
// The transaction and unique auth_user_id constraint make retries and
// concurrent requests converge on one stable Participant.
func (s *Service) Onboard(ctx context.Context, actor auth.Actor, rawDisplayName string) (Participant, error) {
	if actor.Kind == auth.UserKindAdmin ||
		(actor.Kind != auth.UserKindAnonymous && actor.Kind != auth.UserKindRegistered) {
		return Participant{}, ErrAdminNotAllowed
	}
	displayName, err := normalizeDisplayName(rawDisplayName)
	if err != nil {
		return Participant{}, err
	}

	var result Participant
	err = s.store.WithinTx(ctx, func(tx Tx) error {
		existing, err := tx.GetByAuthUserID(ctx, actor.AuthUserID)
		if err == nil {
			result = existing
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}

		created, err := tx.Create(ctx, actor.AuthUserID, displayName)
		if err != nil {
			return err
		}
		if created != nil {
			result = *created
			return nil
		}
		// Another onboarding request won the unique-index race. Read its
		// canonical row inside this transaction and return it unchanged.
		result, err = tx.GetByAuthUserID(ctx, actor.AuthUserID)
		return err
	})
	return result, err
}

func normalizeDisplayName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if units := len(utf16.Encode([]rune(name))); units < 1 || units > 40 {
		return "", ErrDisplayNameInvalid
	}
	return name, nil
}
