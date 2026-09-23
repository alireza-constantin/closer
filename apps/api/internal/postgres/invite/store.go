// Package invite implements the initial-invite transaction port in PostgreSQL.
package invite

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	domain "github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct{ pool *postgres.Pool }

func NewStore(pool *postgres.Pool) *Store { return &Store{pool: pool} }

func (s *Store) GetLanding(ctx context.Context, tokenHash [32]byte) (*domain.Landing, error) {
	var result domain.Landing
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		row, err := sqlc.New(db).GetInitialInviteLanding(ctx, tokenHash[:])
		if err != nil {
			return err
		}
		result = domain.Landing{
			PairID:             row.PairID.String(),
			InviterDisplayName: row.InviterDisplayName,
			RelationshipType:   string(row.RelationshipType),
			IntendedPersonName: nullableText(row.IntendedPersonName),
			ExpiresAt:          row.ExpiresAt.Time,
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Store) Status(ctx context.Context, participantID, pairID string) (*time.Time, error) {
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return nil, err
	}
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return nil, err
	}
	var expiry time.Time
	err = s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		value, queryErr := sqlc.New(db).GetInitialInviteStatus(ctx, sqlc.GetInitialInviteStatusParams{
			PairID: pairUUID, ParticipantID: participantUUID,
		})
		if queryErr != nil {
			return queryErr
		}
		expiry = value.Time
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &expiry, nil
}

func (s *Store) Issue(ctx context.Context, participantID, pairID string, replace bool) (domain.Issued, error) {
	var result domain.Issued
	token, err := domain.NewToken()
	if err != nil {
		return result, err
	}
	hash := sha256.Sum256([]byte(token))
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return result, domain.ErrForbidden
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return result, domain.ErrForbidden
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if _, err := queries.LockActivePair(ctx, pairUUID); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		} else if err != nil {
			return err
		}
		creator, err := queries.GetActiveFirstMembershipForClaim(ctx, pairUUID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		if creator.ParticipantID != participantUUID {
			return domain.ErrForbidden
		}
		if _, err := queries.GetActiveSecondMembershipForClaim(ctx, pairUUID); err == nil {
			return domain.ErrPairClaimed
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		existing, err := queries.FindInitialInviteForIssue(ctx, pairUUID)
		if err == nil {
			if !replace {
				result = domain.Issued{ExpiresAt: existing.ExpiresAt.Time, State: "active"}
				return nil
			}
			if _, err := queries.RevokeUsableInitialInvite(ctx, pairUUID); err != nil {
				return err
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		} else if replace {
			return domain.ErrUnavailable
		}

		expiresAt := time.Now().UTC().Add(domain.Lifetime)
		if _, err := queries.CreateInitialInvite(ctx, sqlc.CreateInitialInviteParams{
			PairID: pairUUID, TokenHash: hash[:], IssuedByParticipantID: creator.ParticipantID,
			ExpiresAt: timestamptz(expiresAt),
		}); err != nil {
			return err
		}
		result = domain.Issued{Token: token, ExpiresAt: expiresAt, State: "issued"}
		return nil
	})
	return result, err
}

func (s *Store) Revoke(ctx context.Context, participantID, pairID string) error {
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return domain.ErrForbidden
	}
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return domain.ErrForbidden
	}
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if _, err := queries.LockActivePair(ctx, pairUUID); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		} else if err != nil {
			return err
		}
		owner, err := queries.GetActiveFirstMembershipForClaim(ctx, pairUUID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		if owner.ParticipantID != participantUUID {
			return domain.ErrForbidden
		}
		_, err = queries.RevokeUsableInitialInvite(ctx, pairUUID)
		return err
	})
}

func (s *Store) GetRejoinLanding(ctx context.Context, tokenHash [32]byte) (*domain.RejoinLanding, error) {
	var result domain.RejoinLanding
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		slot, err := sqlc.New(db).GetRejoinInviteLanding(ctx, tokenHash[:])
		if err != nil {
			return err
		}
		result = domain.RejoinLanding{TargetSlot: string(slot)}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Store) IssueRejoin(ctx context.Context, participantID, pairID string) (domain.RejoinIssued, error) {
	var result domain.RejoinIssued
	token, err := domain.NewToken()
	if err != nil {
		return result, err
	}
	tokenHash := sha256.Sum256([]byte(token))
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return result, domain.ErrForbidden
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return result, domain.ErrForbidden
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		pair, err := queries.LockActivePairForRejoin(ctx, pairUUID)
		if errors.Is(err, pgx.ErrNoRows) || pair.TerminatedAt.Valid {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		actor, err := queries.GetActiveMembershipForRejoinActor(ctx, sqlc.GetActiveMembershipForRejoinActorParams{PairID: pairUUID, ParticipantID: participantUUID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		targetSlot := sqlc.PairSlotSecond
		if actor.Slot == sqlc.PairSlotSecond {
			targetSlot = sqlc.PairSlotFirst
		}
		target, err := queries.GetEligibleRejoinTarget(ctx, sqlc.GetEligibleRejoinTargetParams{PairID: pairUUID, TargetSlot: targetSlot})
		if errors.Is(err, pgx.ErrNoRows) || target.AuthUserKind != "anonymous" {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		active, err := queries.HasActiveAuthSessionForRejoinTarget(ctx, target.AuthUserID)
		if err != nil {
			return err
		}
		if active {
			return domain.ErrRejoinUnavailable
		}
		if err := queries.RevokeActiveRejoinInvitesForTarget(ctx, sqlc.RevokeActiveRejoinInvitesForTargetParams{PairID: pairUUID, TargetSlot: targetSlot, TargetParticipantID: target.ParticipantID}); err != nil {
			return err
		}
		expiresAt := time.Now().UTC().Add(domain.RejoinLifetime)
		if _, err := queries.CreateRejoinInvite(ctx, sqlc.CreateRejoinInviteParams{
			PairID: pairUUID, TargetSlot: targetSlot, TargetParticipantID: target.ParticipantID,
			TokenHash: tokenHash[:], ExpiresAt: timestamptz(expiresAt),
		}); err != nil {
			return err
		}
		result = domain.RejoinIssued{Token: token, ExpiresAt: expiresAt, TargetParticipantDisplayName: target.DisplayName}
		return nil
	})
	return result, err
}

func (s *Store) RevokeRejoin(ctx context.Context, participantID, pairID string) error {
	pairUUID, err := parseUUID(pairID)
	if err != nil {
		return domain.ErrForbidden
	}
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return domain.ErrForbidden
	}
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		pair, err := queries.LockActivePairForRejoin(ctx, pairUUID)
		if errors.Is(err, pgx.ErrNoRows) || pair.TerminatedAt.Valid {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		actor, err := queries.GetActiveMembershipForRejoinActor(ctx, sqlc.GetActiveMembershipForRejoinActorParams{PairID: pairUUID, ParticipantID: participantUUID})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		}
		if err != nil {
			return err
		}
		targetSlot := sqlc.PairSlotSecond
		if actor.Slot == sqlc.PairSlotSecond {
			targetSlot = sqlc.PairSlotFirst
		}
		target, err := queries.GetEligibleRejoinTarget(ctx, sqlc.GetEligibleRejoinTargetParams{PairID: pairUUID, TargetSlot: targetSlot})
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		return queries.RevokeActiveRejoinInvitesForTarget(ctx, sqlc.RevokeActiveRejoinInvitesForTargetParams{PairID: pairUUID, TargetSlot: targetSlot, TargetParticipantID: target.ParticipantID})
	})
}

func (s *Store) Rejoin(ctx context.Context, tokenHash [32]byte, authUserID, displayName string) (domain.Rejoined, error) {
	var result domain.Rejoined
	authUUID, err := parseUUID(authUserID)
	if err != nil {
		return result, domain.ErrRejoinUnavailable
	}
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		resolved, err := queries.GetRejoinInviteByHash(ctx, tokenHash[:])
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		pair, err := queries.LockActivePairForRejoin(ctx, resolved.PairID)
		if errors.Is(err, pgx.ErrNoRows) || pair.TerminatedAt.Valid {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		invite, err := queries.GetRejoinInviteForUpdate(ctx, resolved.ID)
		if errors.Is(err, pgx.ErrNoRows) || invite.RevokedAt.Valid || invite.RedeemedAt.Valid || !invite.ExpiresAt.Time.After(time.Now()) {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		target, err := queries.LockTargetMembershipForRejoin(ctx, sqlc.LockTargetMembershipForRejoinParams{
			PairID:              invite.PairID,
			TargetSlot:          invite.TargetSlot,
			TargetParticipantID: invite.TargetParticipantID,
		})
		if errors.Is(err, pgx.ErrNoRows) || target.ParticipantID != invite.TargetParticipantID || target.AuthUserKind != "anonymous" {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		active, err := queries.HasActiveAuthSessionForRejoinTarget(ctx, target.AuthUserID)
		if err != nil {
			return err
		}
		if active {
			return domain.ErrRejoinUnavailable
		}
		era, err := queries.GetCurrentMembershipEraForRejoin(ctx, invite.PairID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		if target.ID != era.FirstMembershipID && target.ID != era.SecondMembershipID {
			return domain.ErrRejoinUnavailable
		}
		authUser, err := queries.LockAuthUserForRejoin(ctx, authUUID)
		if errors.Is(err, pgx.ErrNoRows) || authUser.DisabledAt.Valid || authUser.Kind == "admin" {
			return domain.ErrRejoinUnavailable
		}
		if err != nil {
			return err
		}
		if _, err := queries.GetParticipantByAuthUserID(ctx, authUUID); err == nil {
			return domain.ErrRejoinUnavailable
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if count, err := queries.EndTargetMembershipForRejoin(ctx, sqlc.EndTargetMembershipForRejoinParams{
			MembershipID:     target.ID,
			EndedDisplayName: pgtype.Text{String: target.DisplayName, Valid: true},
		}); err != nil {
			return err
		} else if count != 1 {
			return domain.ErrRejoinUnavailable
		}
		if count, err := queries.EndMembershipEraForRejoin(ctx, era.ID); err != nil {
			return err
		} else if count != 1 {
			return domain.ErrRejoinUnavailable
		}
		if err := queries.InvalidatePrivateCandidatesForRejoinEra(ctx, era.ID); err != nil {
			return err
		}
		if err := queries.CloseTogetherSessionsForRejoinEra(ctx, sqlc.CloseTogetherSessionsForRejoinEraParams{
			PairID: invite.PairID,
			EraID:  era.ID,
		}); err != nil {
			return err
		}
		if _, err := queries.RevokeAuthSessionsForUser(ctx, sqlc.RevokeAuthSessionsForUserParams{
			AuthUserID: target.AuthUserID,
			RevokedAt:  timestamptz(time.Now().UTC()),
		}); err != nil {
			return err
		}
		replacementParticipantID, err := queries.CreateReplacementParticipantForRejoin(ctx, sqlc.CreateReplacementParticipantForRejoinParams{
			AuthUserID:  authUUID,
			DisplayName: displayName,
		})
		if err != nil {
			return err
		}
		replacementMembershipID, err := queries.CreateReplacementMembershipForRejoin(ctx, sqlc.CreateReplacementMembershipForRejoinParams{
			PairID:        invite.PairID,
			ParticipantID: replacementParticipantID,
			Slot:          invite.TargetSlot,
		})
		if err != nil {
			return err
		}
		firstMembershipID, secondMembershipID := era.FirstMembershipID, era.SecondMembershipID
		if invite.TargetSlot == sqlc.PairSlotFirst {
			firstMembershipID = replacementMembershipID
		} else {
			secondMembershipID = replacementMembershipID
		}
		replacementEraID, err := queries.CreateReplacementMembershipEraForRejoin(ctx, sqlc.CreateReplacementMembershipEraForRejoinParams{
			PairID:             invite.PairID,
			FirstMembershipID:  firstMembershipID,
			SecondMembershipID: secondMembershipID,
		})
		if err != nil {
			return err
		}
		if count, err := queries.RedeemRejoinInvite(ctx, sqlc.RedeemRejoinInviteParams{ID: invite.ID, ParticipantID: replacementParticipantID}); err != nil {
			return err
		} else if count != 1 {
			return domain.ErrRejoinUnavailable
		}
		if err := queries.RevokeActiveRejoinInvitesForTarget(ctx, sqlc.RevokeActiveRejoinInvitesForTargetParams{PairID: invite.PairID, TargetSlot: invite.TargetSlot, TargetParticipantID: invite.TargetParticipantID}); err != nil {
			return err
		}
		result = domain.Rejoined{PairID: invite.PairID.String(), MembershipEraID: replacementEraID.String(), ParticipantID: replacementParticipantID.String()}
		return nil
	})
	if err != nil {
		return domain.Rejoined{}, fmt.Errorf("redeem rejoin credential: %w", err)
	}
	return result, nil
}

func (s *Store) Claim(ctx context.Context, tokenHash [32]byte, participantID string) (domain.Claimed, error) {
	participantUUID, err := parseUUID(participantID)
	if err != nil {
		return domain.Claimed{}, domain.ErrParticipantRequired
	}
	var result domain.Claimed
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		resolved, err := queries.GetInitialInvitePairByHash(ctx, tokenHash[:])
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		}
		if err != nil {
			return err
		}
		pair, err := queries.LockPairForInitialClaim(ctx, resolved.PairID)
		if errors.Is(err, pgx.ErrNoRows) || pair.TerminatedAt.Valid {
			return domain.ErrUnavailable
		}
		if err != nil {
			return err
		}
		invite, err := queries.GetInitialInviteForUpdate(ctx, resolved.ID)
		if errors.Is(err, pgx.ErrNoRows) || invite.RevokedAt.Valid || invite.RedeemedAt.Valid {
			return domain.ErrUnavailable
		}
		if err != nil {
			return err
		}
		first, err := queries.GetActiveFirstMembershipForClaim(ctx, resolved.PairID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		}
		if err != nil {
			return err
		}
		if first.ParticipantID == participantUUID {
			return domain.ErrSelfClaim
		}
		if exists, err := queries.ParticipantExists(ctx, participantUUID); err != nil {
			return err
		} else if !exists {
			return domain.ErrParticipantRequired
		}
		if _, err := queries.GetActiveSecondMembershipForClaim(ctx, resolved.PairID); err == nil {
			return domain.ErrPairClaimed
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		firstID, secondID := first.ParticipantID, participantUUID
		if firstID.String() > secondID.String() {
			firstID, secondID = secondID, firstID
		}
		if err := queries.LockClaimParticipantPair(ctx, firstID.String()+":"+secondID.String()); err != nil {
			return err
		}
		duplicate, err := queries.HasDuplicateActiveParticipantPair(ctx, sqlc.HasDuplicateActiveParticipantPairParams{
			ExcludedPairID: resolved.PairID, ParticipantA: firstID, ParticipantB: secondID,
		})
		if err != nil {
			return err
		}
		if duplicate {
			return domain.ErrDuplicatePair
		}
		secondMembershipID, err := queries.CreateClaimMembership(ctx, sqlc.CreateClaimMembershipParams{
			PairID: resolved.PairID, ParticipantID: participantUUID,
		})
		if err != nil {
			return err
		}
		eraID, err := queries.CreateInitialMembershipEra(ctx, sqlc.CreateInitialMembershipEraParams{
			PairID: resolved.PairID, FirstMembershipID: first.ID, SecondMembershipID: secondMembershipID,
		})
		if err != nil {
			return err
		}
		// Initial claim is the membership boundary for Together. Close every
		// pre-claim session in the same transaction before the claim commits.
		// The Pair lock above gives this update the same serialization boundary
		// as Together start/end mutations.
		if _, err := db.Exec(ctx, `UPDATE together_session SET ended_at=COALESCE(ended_at, clock_timestamp()) WHERE pair_id=$1 AND membership_era_id IS NULL AND ended_at IS NULL`, resolved.PairID); err != nil {
			return err
		}
		if err := queries.ClearIntendedPersonName(ctx, resolved.PairID); err != nil {
			return err
		}
		redeemed, err := queries.RedeemInitialInvite(ctx, sqlc.RedeemInitialInviteParams{
			ParticipantID: participantUUID, ID: resolved.ID,
		})
		if err != nil {
			return err
		}
		if redeemed != 1 {
			return domain.ErrUnavailable
		}
		result = domain.Claimed{PairID: resolved.PairID.String(), MembershipEraID: eraID.String()}
		return nil
	})
	if err != nil {
		return domain.Claimed{}, fmt.Errorf("claim initial invitation: %w", err)
	}
	return result, nil
}

func parseUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return result, nil
}

func nullableText(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func timestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}
