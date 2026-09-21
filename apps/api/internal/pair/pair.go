// Package pair owns Pair creation, access, and participant-relative projections.
package pair

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode/utf16"
)

var (
	ErrParticipantRequired       = errors.New("Participant is required")
	ErrParticipantNotFound       = errors.New("Participant not found")
	ErrIntendedPersonNameInvalid = errors.New("intended person name is invalid")
	ErrRelationshipTypeInvalid   = errors.New("relationship type is invalid")
	ErrCreationRequestInvalid    = errors.New("Pair creation request ID is invalid")
	ErrCreationRequestConflict   = errors.New("Pair creation request conflicts")
	ErrPairNotFound              = errors.New("Pair not found")
	ErrPairAlreadyClaimed        = errors.New("Pair second slot is already claimed")
	ErrPairTerminated            = errors.New("Pair is terminated")
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type RelationshipType string

const (
	RelationshipPartner RelationshipType = "partner"
	RelationshipFriend  RelationshipType = "friend"
)

type Slot string

const (
	SlotFirst  Slot = "first"
	SlotSecond Slot = "second"
)

type Pair struct {
	ID                 string
	RelationshipType   RelationshipType
	IntendedPersonName *string
}

type Member struct {
	Slot        Slot
	DisplayName string
}

type Space struct {
	PairID                      string
	RelationshipType            RelationshipType
	State                       string
	OtherParticipantDisplayName *string
	IntendedPersonName          *string
}

// Access is the narrow Pair authority capability shared with future domains.
// It contains current membership, the other slot when claimed, terminal state,
// and the active era without exposing persistence rows.
type Access struct {
	PairID                      string
	RelationshipType            RelationshipType
	IntendedPersonName          *string
	MembershipID                string
	ActorSlot                   Slot
	OtherParticipantID          *string
	OtherParticipantDisplayName *string
	MembershipEraID             *string
}

type Entry struct {
	PairID             string
	State              string
	RelationshipType   RelationshipType
	IntendedPersonName *string
	Members            []Member
}

type CreateInput struct {
	ParticipantID      string
	IntendedPersonName string
	RelationshipType   string
	ClientRequestID    string
}

type Tx interface {
	ParticipantExists(context.Context, string) (bool, error)
	CreatePair(context.Context, Pair, string) (*Pair, error)
	GetCreatedPairByRequestAndParticipant(context.Context, string, string) (Pair, error)
	CreateCreatorMembership(context.Context, string, string) error
	LockActivePair(context.Context, string) (bool, error)
	ParticipantHasActiveMembership(context.Context, string, string) (bool, error)
	HasActiveSecondSlot(context.Context, string) (bool, error)
	UpdateIntendedPersonName(context.Context, string, string) (Pair, error)
}

type Store interface {
	WithinTx(context.Context, func(Tx) error) error
	ListSpaces(context.Context, string) ([]Space, error)
	GetActivePairAccess(context.Context, string, string) (Access, error)
	ListActiveMembers(context.Context, string) ([]Member, error)
	FindFormerTerminatedPair(context.Context, string, string) (string, error)
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Pair, error) {
	if input.ParticipantID == "" {
		return Pair{}, ErrParticipantRequired
	}
	intendedName, err := normalizeIntendedPersonName(input.IntendedPersonName)
	if err != nil {
		return Pair{}, err
	}
	relationship := RelationshipType(input.RelationshipType)
	if relationship != RelationshipPartner && relationship != RelationshipFriend {
		return Pair{}, ErrRelationshipTypeInvalid
	}
	requestID := strings.TrimSpace(input.ClientRequestID)
	if requestID != "" && !uuidPattern.MatchString(requestID) {
		return Pair{}, ErrCreationRequestInvalid
	}
	createdPair := Pair{RelationshipType: relationship, IntendedPersonName: &intendedName}

	var result Pair
	err = s.store.WithinTx(ctx, func(tx Tx) error {
		exists, err := tx.ParticipantExists(ctx, input.ParticipantID)
		if err != nil {
			return err
		}
		if !exists {
			return ErrParticipantNotFound
		}
		created, err := tx.CreatePair(ctx, createdPair, requestID)
		if err != nil {
			return err
		}
		if created == nil {
			if requestID == "" {
				return ErrCreationRequestConflict
			}
			result, err = tx.GetCreatedPairByRequestAndParticipant(ctx, requestID, input.ParticipantID)
			if errors.Is(err, ErrPairNotFound) {
				return ErrCreationRequestConflict
			}
			return err
		}
		if err := tx.CreateCreatorMembership(ctx, created.ID, input.ParticipantID); err != nil {
			return err
		}
		result = *created
		return nil
	})
	return result, err
}

func (s *Service) ListSpaces(ctx context.Context, participantID string) ([]Space, error) {
	if participantID == "" {
		return nil, ErrParticipantRequired
	}
	return s.store.ListSpaces(ctx, participantID)
}

func (s *Service) GetAccess(ctx context.Context, participantID, pairID string) (Access, error) {
	if participantID == "" {
		return Access{}, ErrParticipantRequired
	}
	return s.store.GetActivePairAccess(ctx, participantID, pairID)
}

func (s *Service) GetEntry(ctx context.Context, participantID, pairID string) (Entry, error) {
	access, err := s.GetAccess(ctx, participantID, pairID)
	if err != nil {
		if !errors.Is(err, ErrPairNotFound) {
			return Entry{}, err
		}
		formerPairID, formerErr := s.store.FindFormerTerminatedPair(ctx, pairID, participantID)
		if errors.Is(formerErr, ErrPairNotFound) {
			return Entry{}, ErrPairNotFound
		}
		if formerErr != nil {
			return Entry{}, formerErr
		}
		return Entry{PairID: formerPairID, State: "terminated"}, nil
	}
	members, err := s.store.ListActiveMembers(ctx, pairID)
	if err != nil {
		return Entry{}, err
	}
	state := "waiting"
	if access.OtherParticipantID != nil {
		state = "connected"
	}
	return Entry{
		PairID: pairID, State: state, RelationshipType: access.RelationshipType,
		IntendedPersonName: access.IntendedPersonName, Members: members,
	}, nil
}

func (s *Service) UpdateIntendedPersonName(ctx context.Context, participantID, pairID, value string) (Pair, error) {
	if participantID == "" {
		return Pair{}, ErrParticipantRequired
	}
	name, err := normalizeIntendedPersonName(value)
	if err != nil {
		return Pair{}, err
	}
	var result Pair
	err = s.store.WithinTx(ctx, func(tx Tx) error {
		locked, err := tx.LockActivePair(ctx, pairID)
		if err != nil {
			return err
		}
		if !locked {
			return ErrPairNotFound
		}
		isMember, err := tx.ParticipantHasActiveMembership(ctx, pairID, participantID)
		if err != nil {
			return err
		}
		if !isMember {
			return ErrPairNotFound
		}
		claimed, err := tx.HasActiveSecondSlot(ctx, pairID)
		if err != nil {
			return err
		}
		if claimed {
			return ErrPairAlreadyClaimed
		}
		result, err = tx.UpdateIntendedPersonName(ctx, pairID, name)
		return err
	})
	return result, err
}

func normalizeIntendedPersonName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if units := len(utf16.Encode([]rune(name))); units < 1 || units > 40 {
		return "", ErrIntendedPersonNameInvalid
	}
	return name, nil
}
