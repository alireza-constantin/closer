package together

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	domain "github.com/alireza-constantin/closer/apps/api/internal/together"
)

func TestTogetherStartAndAdvanceRetryConverge(t *testing.T) {
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to run Together PostgreSQL tests")
		}
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	p, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()

	var authUserID, participantID, pairID, questionA, questionB string
	err = p.WithConnection(ctx, func(db postgres.QueryDB) error {
		if err := db.QueryRow(ctx, `INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text`).Scan(&authUserID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, `INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'Together test') RETURNING id::text`, authUserID).Scan(&participantID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, `INSERT INTO pair(relationship_type, intended_person_name) VALUES ('partner', 'Guest') RETURNING id::text`).Scan(&pairID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1,$2,'first')`, pairID, participantID); err != nil {
			return err
		}
		for _, text := range []string{"Together test A", "Together test B"} {
			var questionID, revisionID string
			if err := db.QueryRow(ctx, `INSERT INTO question(is_active) VALUES (true) RETURNING id::text`).Scan(&questionID); err != nil {
				return err
			}
			if err := db.QueryRow(ctx, `INSERT INTO question_revision(question_id,text,category,relationship_fit,mode_fit,intensity,revision_number) VALUES ($1,$2,'fun','partner','together','light',1) RETURNING id::text`, questionID, text).Scan(&revisionID); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, `UPDATE question SET current_revision_id=$2 WHERE id=$1`, questionID, revisionID); err != nil {
				return err
			}
			if questionA == "" {
				questionA = questionID
			} else {
				questionB = questionID
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = p.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), `DELETE FROM pair WHERE id=$1`, pairID)
			for _, questionID := range []string{questionA, questionB} {
				_, _ = db.Exec(context.Background(), `UPDATE question SET current_revision_id=NULL WHERE id=$1`, questionID)
				_, _ = db.Exec(context.Background(), `DELETE FROM question_revision WHERE question_id=$1`, questionID)
				_, _ = db.Exec(context.Background(), `DELETE FROM question WHERE id=$1`, questionID)
			}
			_, _ = db.Exec(context.Background(), `DELETE FROM participant WHERE id=$1`, participantID)
			_, _ = db.Exec(context.Background(), `DELETE FROM auth_user WHERE id=$1`, authUserID)
			return nil
		})
	})

	service := domain.NewService(NewStore(p))
	started, err := service.Start(ctx, domain.StartInput{ParticipantID: participantID, PairID: pairID, Category: "fun", ClientRequestID: "123e4567-e89b-12d3-a456-426614174000", SelectionSeed: "retry-seed"})
	if err != nil {
		t.Fatal(err)
	}
	if started.QuestionID != questionA && started.QuestionID != questionB {
		t.Fatalf("unexpected first question %s", started.QuestionID)
	}
	first, err := service.Advance(ctx, domain.AdvanceInput{PlaybackInput: domain.PlaybackInput{ParticipantID: participantID, PairID: pairID, SessionID: started.SessionID}, Action: "next", ClientRequestID: "223e4567-e89b-12d3-a456-426614174000", CurrentQuestionID: started.QuestionID})
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.Advance(ctx, domain.AdvanceInput{PlaybackInput: domain.PlaybackInput{ParticipantID: participantID, PairID: pairID, SessionID: started.SessionID}, Action: "next", ClientRequestID: "223e4567-e89b-12d3-a456-426614174000", CurrentQuestionID: started.QuestionID})
	if err != nil || first != retry {
		t.Fatalf("advance retry = %#v, %v; first = %#v", retry, err, first)
	}
}
