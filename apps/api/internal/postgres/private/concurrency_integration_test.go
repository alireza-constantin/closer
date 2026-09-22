package private_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresprivate "github.com/alireza-constantin/closer/apps/api/internal/postgres/private"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	domain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
)

type fixture struct {
	pool                                                                      *postgres.Pool
	service                                                                   *domain.Service
	questions                                                                 *question.Service
	pairID, firstID, secondID, adminID, firstAuthID, secondAuthID, questionID string
}

func openFixture(t *testing.T) fixture {
	t.Helper()
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to run Private PostgreSQL checks")
		}
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	p, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	f.pool = p
	if err := p.WithConnection(ctx, func(db postgres.QueryDB) error {
		for _, target := range []*string{&f.firstAuthID, &f.secondAuthID, &f.adminID} {
			if err := db.QueryRow(ctx, "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(target); err != nil {
				return err
			}
		}
		if _, err := db.Exec(ctx, "UPDATE auth_user SET kind = 'admin' WHERE id = $1", f.adminID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "INSERT INTO admin_user(auth_user_id, created_at) VALUES ($1, now())", f.adminID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'First') RETURNING id::text", f.firstAuthID).Scan(&f.firstID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'Second') RETURNING id::text", f.secondAuthID).Scan(&f.secondID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair(relationship_type) VALUES ('partner') RETURNING id::text").Scan(&f.pairID); err != nil {
			return err
		}
		var firstMembership, secondMembership string
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'first') RETURNING id::text", f.pairID, f.firstID).Scan(&firstMembership); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", f.pairID, f.secondID).Scan(&secondMembership); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3)", f.pairID, firstMembership, secondMembership)
		return err
	}); err != nil {
		p.Close()
		t.Fatal(err)
	}
	store := postgresprivate.NewStore(p)
	f.service = domain.NewService(store)
	f.questions = question.NewService(postgresquestion.NewStore(p, store))
	created, err := f.questions.Create(ctx, question.RevisionFields{Text: "P-01 candidate text", Category: "fun", RelationshipFit: "both", ModeFit: "private", Intensity: "light"}, f.adminID)
	if err != nil {
		p.Close()
		t.Fatal(err)
	}
	f.questionID = created.ID
	if _, err := f.questions.SetActivity(ctx, created.ID, "activate", f.adminID); err != nil {
		p.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = p.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id = $1", f.pairID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_lifecycle_event WHERE question_id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM admin_user WHERE auth_user_id = $1", f.adminID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id IN ($1, $2)", f.firstID, f.secondID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id IN ($1, $2, $3)", f.firstAuthID, f.secondAuthID, f.adminID)
			return nil
		})
		p.Close()
	})
	return f
}

func TestConcurrentStartsConvergeAndWaitingProjectionHasNoCandidate(t *testing.T) {
	f := openFixture(t)
	start := make(chan struct{})
	results := make(chan domain.View, 2)
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, participantID := range []string{f.firstID, f.secondID} {
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			<-start
			view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: id, PairID: f.pairID, Category: "fun"})
			results <- view
			errorsSeen <- err
		}(participantID)
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsSeen)
	var views []domain.View
	for view := range results {
		views = append(views, view)
	}
	for err := range errorsSeen {
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(views) != 2 || views[0].ConversationID != views[1].ConversationID {
		t.Fatalf("start results did not converge: %+v", views)
	}
	var candidate, waiting domain.View
	if views[0].State == "CANDIDATE" {
		candidate, waiting = views[0], views[1]
	} else {
		candidate, waiting = views[1], views[0]
	}
	if candidate.Candidate == nil || waiting.State != "WAITING_FOR_CREATOR" {
		t.Fatalf("candidate/waiting = %+v / %+v", candidate, waiting)
	}
	encoded, err := json.Marshal(waiting)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "candidate") || strings.Contains(string(encoded), "P-01 candidate text") {
		t.Fatalf("waiting projection leaked candidate: %s", encoded)
	}
}

func TestWithdrawalInvalidatesUnresolvedCandidateInSameDatabaseBoundary(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil {
		t.Fatal(err)
	}
	if view.Candidate == nil {
		t.Fatal("expected candidate")
	}
	if _, err := f.questions.Withdraw(context.Background(), f.questionID, view.Candidate.Question.RevisionID, "safety", f.adminID); err != nil {
		t.Fatal(err)
	}
	read, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID})
	if err != nil {
		t.Fatal(err)
	}
	if read.State != "EXHAUSTED" || read.Candidate != nil {
		t.Fatalf("after invalidation = %+v", read)
	}
}
