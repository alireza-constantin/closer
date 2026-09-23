package together

import (
	"context"
	"os"
	"sync"
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

	var authUserID, participantID, pairID, questionA, questionB string
	t.Cleanup(func() {
		defer p.Close()
		if err := p.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			if pairID != "" {
				if _, err := db.Exec(context.Background(), `DELETE FROM pair WHERE id=$1`, pairID); err != nil {
					return err
				}
			}
			for _, questionID := range []string{questionA, questionB} {
				if questionID == "" {
					continue
				}
				if _, err := db.Exec(context.Background(), `UPDATE question SET current_revision_id=NULL WHERE id=$1`, questionID); err != nil {
					return err
				}
				if _, err := db.Exec(context.Background(), `DELETE FROM question_revision WHERE question_id=$1`, questionID); err != nil {
					return err
				}
				if _, err := db.Exec(context.Background(), `DELETE FROM question WHERE id=$1`, questionID); err != nil {
					return err
				}
			}
			if participantID != "" {
				if _, err := db.Exec(context.Background(), `DELETE FROM participant WHERE id=$1`, participantID); err != nil {
					return err
				}
			}
			if authUserID != "" {
				if _, err := db.Exec(context.Background(), `DELETE FROM auth_user WHERE id=$1`, authUserID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			t.Errorf("clean up Together retry fixture: %v", err)
		}
	})
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

	service := domain.NewService(NewStore(p))
	start := make(chan struct{})
	starts := make(chan domain.StartResult, 2)
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, requestID := range []string{"123e4567-e89b-12d3-a456-426614174000", "223e4567-e89b-12d3-a456-426614174000"} {
		wait.Add(1)
		go func(requestID string) {
			defer wait.Done()
			<-start
			result, startErr := service.Start(ctx, domain.StartInput{ParticipantID: participantID, PairID: pairID, Category: "fun", ClientRequestID: requestID, SelectionSeed: "retry-seed"})
			starts <- result
			errorsSeen <- startErr
		}(requestID)
	}
	close(start)
	wait.Wait()
	close(starts)
	close(errorsSeen)
	var started domain.StartResult
	for result := range starts {
		if started.SessionID == "" {
			started = result
			continue
		}
		if result.SessionID != started.SessionID || result.QuestionID != started.QuestionID || result.QuestionRevisionID != started.QuestionRevisionID {
			t.Fatalf("concurrent starts diverged: %#v and %#v", started, result)
		}
	}
	for startErr := range errorsSeen {
		if startErr != nil {
			t.Fatal(startErr)
		}
	}
	// Eligible Together questions are shared across pairs, so a residual
	// question in closer_test may be selected ahead of this test's fixtures.
	// Retry convergence depends on both starts returning the same complete
	// result, not on which eligible question wins selection.
	if started.SessionID == "" || started.QuestionID == "" || started.QuestionRevisionID == "" {
		t.Fatalf("incomplete start result: %#v", started)
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
