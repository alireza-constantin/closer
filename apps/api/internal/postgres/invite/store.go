// Package invite implements the initial-invite transaction port in PostgreSQL.
package invite

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"time"

	domain "github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/jackc/pgx/v5"
)

type Store struct{ pool *postgres.Pool }

func NewStore(pool *postgres.Pool) *Store { return &Store{pool: pool} }

func (s *Store) GetLanding(ctx context.Context, tokenHash [32]byte) (*domain.Landing, error) {
	var v domain.Landing
	var intended *string
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, `SELECT p.id::text, owner.display_name, p.relationship_type::text, p.intended_person_name, i.expires_at
		FROM initial_invite i JOIN pair p ON p.id=i.pair_id
		JOIN pair_membership m ON m.pair_id=p.id AND m.slot='first' AND m.ended_at IS NULL
		JOIN participant owner ON owner.id=m.participant_id
		WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.redeemed_at IS NULL AND i.expires_at>clock_timestamp() AND p.terminated_at IS NULL`, tokenHash[:]).Scan(&v.PairID, &v.InviterDisplayName, &v.RelationshipType, &intended, &v.ExpiresAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.IntendedPersonName = intended
	return &v, nil
}

func (s *Store) Status(ctx context.Context, participantID, pairID string) (*time.Time, error) {
	var expiry time.Time
	err := s.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, `SELECT i.expires_at FROM pair p JOIN pair_membership m ON m.pair_id=p.id AND m.slot='first' AND m.ended_at IS NULL JOIN initial_invite i ON i.pair_id=p.id AND i.revoked_at IS NULL AND i.redeemed_at IS NULL AND i.expires_at>clock_timestamp() WHERE p.id=$1 AND p.terminated_at IS NULL AND m.participant_id=$2 AND NOT EXISTS(SELECT 1 FROM pair_membership s WHERE s.pair_id=p.id AND s.slot='second' AND s.ended_at IS NULL) ORDER BY i.created_at DESC LIMIT 1`, pairID, participantID).Scan(&expiry)
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
	var out domain.Issued
	token, err := domain.NewToken()
	if err != nil {
		return out, err
	}
	hash := sha256.Sum256([]byte(token))
	err = s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var pairExists bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pair WHERE id=$1 AND terminated_at IS NULL)`, pairID).Scan(&pairExists); err != nil {
			return err
		}
		if !pairExists {
			return domain.ErrForbidden
		}
		var firstID string
		var creator string
		if err := db.QueryRow(ctx, `SELECT m.participant_id::text FROM pair_membership m WHERE m.pair_id=$1 AND m.slot='first' AND m.ended_at IS NULL`, pairID).Scan(&creator); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		} else if err != nil {
			return err
		}
		if creator != participantID {
			return domain.ErrForbidden
		}
		if _, err := db.Exec(ctx, `SELECT id FROM pair WHERE id=$1 FOR UPDATE`, pairID); err != nil {
			return err
		}
		var second bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pair_membership WHERE pair_id=$1 AND slot='second' AND ended_at IS NULL)`, pairID).Scan(&second); err != nil {
			return err
		}
		if second {
			return domain.ErrPairClaimed
		}
		var existingExpiry time.Time
		err := db.QueryRow(ctx, `SELECT expires_at FROM initial_invite WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, pairID).Scan(&existingExpiry)
		if err == nil {
			if !replace {
				out = domain.Issued{ExpiresAt: existingExpiry, State: "active"}
				return nil
			}
			if _, err = db.Exec(ctx, `UPDATE initial_invite SET revoked_at=now() WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL`, pairID); err != nil {
				return err
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		} else if replace {
			return domain.ErrUnavailable
		}
		if _, err = db.Exec(ctx, `UPDATE initial_invite SET revoked_at=now() WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL`, pairID); err != nil {
			return err
		}
		if err = db.QueryRow(ctx, `SELECT participant_id::text FROM pair_membership WHERE pair_id=$1 AND slot='first' AND ended_at IS NULL`, pairID).Scan(&firstID); err != nil {
			return err
		}
		if err = db.QueryRow(ctx, `SELECT clock_timestamp() + ($1 * interval '1 second')`, domain.Lifetime.Seconds()).Scan(&out.ExpiresAt); err != nil {
			return err
		}
		if _, err = db.Exec(ctx, `INSERT INTO initial_invite(pair_id,token_hash,issued_by_participant_id,expires_at) VALUES($1,$2,$3,$4)`, pairID, hash[:], firstID, out.ExpiresAt); err != nil {
			return err
		}
		out.Token = token
		out.State = "issued"
		return nil
	})
	return out, err
}

func (s *Store) Revoke(ctx context.Context, participantID, pairID string) error {
	return s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var owner string
		if err := db.QueryRow(ctx, `SELECT m.participant_id::text FROM pair_membership m JOIN pair p ON p.id=m.pair_id WHERE p.id=$1 AND p.terminated_at IS NULL AND m.slot='first' AND m.ended_at IS NULL FOR UPDATE OF p`, pairID).Scan(&owner); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrForbidden
		} else if err != nil {
			return err
		}
		if owner != participantID {
			return domain.ErrForbidden
		}
		_, err := db.Exec(ctx, `UPDATE initial_invite SET revoked_at=now() WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL`, pairID)
		return err
	})
}

func (s *Store) Claim(ctx context.Context, tokenHash [32]byte, participantID string) (domain.Claimed, error) {
	var out domain.Claimed
	err := s.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var inviteID, pairID string
		// Match the TypeScript aggregate protocol: resolve the credential without
		// locking, lock Pair first, then lock and revalidate the credential.
		if err := db.QueryRow(ctx, `SELECT id::text,pair_id::text FROM initial_invite WHERE token_hash=$1`, tokenHash[:]).Scan(&inviteID, &pairID); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		} else if err != nil {
			return err
		}
		var terminated bool
		if err := db.QueryRow(ctx, `SELECT terminated_at IS NOT NULL FROM pair WHERE id=$1 FOR UPDATE`, pairID).Scan(&terminated); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		} else if err != nil {
			return err
		}
		if terminated {
			return domain.ErrUnavailable
		}
		var lockedInviteID string
		if err := db.QueryRow(ctx, `SELECT id::text FROM initial_invite WHERE id=$1 FOR UPDATE`, inviteID).Scan(&lockedInviteID); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		} else if err != nil {
			return err
		}
		var usable bool
		if err := db.QueryRow(ctx, `SELECT revoked_at IS NULL AND redeemed_at IS NULL AND expires_at>clock_timestamp() FROM initial_invite WHERE id=$1`, inviteID).Scan(&usable); err != nil {
			return err
		}
		if !usable {
			return domain.ErrUnavailable
		}
		var firstID, firstParticipant string
		if err := db.QueryRow(ctx, `SELECT id::text,participant_id::text FROM pair_membership WHERE pair_id=$1 AND slot='first' AND ended_at IS NULL`, pairID).Scan(&firstID, &firstParticipant); errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrUnavailable
		} else if err != nil {
			return err
		}
		if firstParticipant == participantID {
			return domain.ErrSelfClaim
		}
		var claimantExists bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM participant WHERE id=$1)`, participantID).Scan(&claimantExists); err != nil {
			return err
		}
		if !claimantExists {
			return domain.ErrParticipantRequired
		}
		var occupied bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pair_membership WHERE pair_id=$1 AND slot='second' AND ended_at IS NULL)`, pairID).Scan(&occupied); err != nil {
			return err
		}
		if occupied {
			return domain.ErrPairClaimed
		}
		pairIDs := []string{firstParticipant, participantID}
		sort.Strings(pairIDs)
		lockKey := pairIDs[0] + ":" + pairIDs[1]
		if _, err := db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
			return err
		}
		var duplicate bool
		if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pair_membership a JOIN pair_membership b ON b.pair_id=a.pair_id JOIN pair_membership_era e ON e.pair_id=a.pair_id AND e.ended_at IS NULL JOIN pair p ON p.id=a.pair_id AND p.terminated_at IS NULL WHERE a.pair_id<>$1 AND a.ended_at IS NULL AND b.ended_at IS NULL AND a.participant_id=$2 AND b.participant_id=$3)`, pairID, pairIDs[0], pairIDs[1]).Scan(&duplicate); err != nil {
			return err
		}
		if duplicate {
			return domain.ErrDuplicatePair
		}
		var secondID, eraID string
		if err := db.QueryRow(ctx, `INSERT INTO pair_membership(pair_id,participant_id,slot) VALUES($1,$2,'second') RETURNING id::text`, pairID, participantID).Scan(&secondID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, `INSERT INTO pair_membership_era(pair_id,first_membership_id,second_membership_id) VALUES($1,$2,$3) RETURNING id::text`, pairID, firstID, secondID).Scan(&eraID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `UPDATE pair SET intended_person_name=NULL WHERE id=$1`, pairID); err != nil {
			return err
		}
		// GO-05 closes pre-claim Together Sessions once their schema is ported.
		// The current GO-04 executable schema has no Together relation to mutate.
		var redeemed int64
		if err := db.QueryRow(ctx, `UPDATE initial_invite SET redeemed_at=clock_timestamp(), redeemed_by_participant_id=$2 WHERE id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at>clock_timestamp() RETURNING 1`, inviteID, participantID).Scan(&redeemed); err != nil {
			return domain.ErrUnavailable
		}
		out = domain.Claimed{PairID: pairID, MembershipEraID: eraID}
		return nil
	})
	if err != nil {
		return domain.Claimed{}, fmt.Errorf("claim initial invitation: %w", err)
	}
	return out, nil
}
