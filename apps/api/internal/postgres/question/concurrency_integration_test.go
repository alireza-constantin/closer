package question_test

import (
	"context"
	"errors"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
)

func questionFixture(t *testing.T) (*postgres.Pool, *question.Service, string) {
	t.Helper()
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to run Question PostgreSQL concurrency checks")
		}
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var adminID string
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'admin', now()) RETURNING id::text").Scan(&adminID)
	}); err != nil {
		pool.Close()
		t.Fatal(err)
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		_, err := db.Exec(ctx, "INSERT INTO admin_user(auth_user_id, created_at) VALUES ($1, now())", adminID)
		return err
	}); err != nil {
		pool.Close()
		t.Fatal(err)
	}
	store := postgresquestion.NewStore(pool)
	service := question.NewService(store)
	t.Cleanup(func() {
		_ = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, err := db.Exec(context.Background(), "DELETE FROM auth_user WHERE id = $1", adminID)
			return err
		})
		pool.Close()
	})
	return pool, service, adminID
}

func createQuestion(t *testing.T, pool *postgres.Pool, service *question.Service, adminID string) question.Question {
	t.Helper()
	value, err := service.Create(context.Background(), question.RevisionFields{
		Text: "Concurrency fixture " + time.Now().UTC().Format(time.RFC3339Nano), Category: "fun",
		RelationshipFit: "both", ModeFit: "both", Intensity: "light",
	}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			if _, err := db.Exec(context.Background(), "DELETE FROM question_lifecycle_event WHERE question_id = $1", value.ID); err != nil {
				return err
			}
			if _, err := db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", value.ID); err != nil {
				return err
			}
			if _, err := db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", value.ID); err != nil {
				return err
			}
			_, err := db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", value.ID)
			return err
		})
	})
	return value
}

func TestQuestionStaleEditAllowsExactlyOneCommit(t *testing.T) {
	pool, service, adminID := questionFixture(t)
	created := createQuestion(t, pool, service, adminID)
	start := make(chan struct{})
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, text := range []string{"Concurrent edit A", "Concurrent edit B"} {
		wait.Add(1)
		go func(text string) {
			defer wait.Done()
			<-start
			_, err := service.Edit(context.Background(), created.ID, question.RevisionFields{
				Text: text, Category: "fun", RelationshipFit: "both", ModeFit: "both", Intensity: "light",
			}, created.CurrentRevisionID, adminID)
			errorsSeen <- err
		}(text)
	}
	close(start)
	wait.Wait()
	close(errorsSeen)
	var success, conflicts int
	for err := range errorsSeen {
		if err == nil {
			success++
		} else if errors.Is(err, question.ErrConflict) {
			conflicts++
		} else {
			t.Fatalf("unexpected edit error: %v", err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success/conflict = %d/%d, want 1/1", success, conflicts)
	}
}

func TestQuestionRevisionRetriesKeepOrdinalsMonotonic(t *testing.T) {
	pool, service, adminID := questionFixture(t)
	created := createQuestion(t, pool, service, adminID)
	const writers = 8
	var wait sync.WaitGroup
	for writer := 0; writer < writers; writer++ {
		wait.Add(1)
		go func(writer int) {
			defer wait.Done()
			for {
				current, err := service.Get(context.Background(), created.ID)
				if err != nil {
					t.Errorf("read current revision: %v", err)
					return
				}
				_, err = service.Edit(context.Background(), created.ID, question.RevisionFields{
					Text: "Ordinal writer " + string(rune('A'+writer)), Category: "fun", RelationshipFit: "both", ModeFit: "both", Intensity: "light",
				}, current.CurrentRevisionID, adminID)
				if err == nil {
					return
				}
				if !errors.Is(err, question.ErrConflict) {
					t.Errorf("revision write: %v", err)
					return
				}
			}
		}(writer)
	}
	wait.Wait()
	current, err := service.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !current.IsActive && current.CurrentRevisionID == "" {
		t.Fatal("current revision pointer is empty")
	}
	var ordinals []int32
	revisions, err := service.ListRevisions(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, revision := range revisions {
		ordinals = append(ordinals, revision.RevisionNumber)
	}
	sort.Slice(ordinals, func(i, j int) bool { return ordinals[i] < ordinals[j] })
	if len(ordinals) != writers+1 {
		t.Fatalf("revision count = %d, want %d", len(ordinals), writers+1)
	}
	for index, ordinal := range ordinals {
		if ordinal != int32(index+1) {
			t.Fatalf("ordinals = %v, want contiguous sequence", ordinals)
		}
	}
}

func TestQuestionActivateAndWithdrawCannotLeaveImpossibleState(t *testing.T) {
	pool, service, adminID := questionFixture(t)
	created := createQuestion(t, pool, service, adminID)
	start := make(chan struct{})
	errorsSeen := make(chan error, 2)
	go func() {
		<-start
		_, err := service.SetActivity(context.Background(), created.ID, "activate", adminID)
		errorsSeen <- err
	}()
	go func() {
		<-start
		_, err := service.Withdraw(context.Background(), created.ID, created.CurrentRevisionID, "unsafe wording", adminID)
		errorsSeen <- err
	}()
	close(start)
	first := <-errorsSeen
	second := <-errorsSeen
	if first != nil && !errors.Is(first, question.ErrCurrentWithdrawn) && !errors.Is(first, question.ErrConflict) {
		t.Fatalf("unexpected first race result: %v", first)
	}
	if second != nil && !errors.Is(second, question.ErrCurrentWithdrawn) && !errors.Is(second, question.ErrConflict) {
		t.Fatalf("unexpected second race result: %v", second)
	}
	final, err := service.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Current.Withdrawn && final.IsActive {
		t.Fatal("withdrawn current revision left the Question active")
	}
}

func TestQuestionRestoreAndEditSerializeAgainstOneExpectedRevision(t *testing.T) {
	pool, service, adminID := questionFixture(t)
	created := createQuestion(t, pool, service, adminID)
	second, err := service.Edit(context.Background(), created.ID, question.RevisionFields{
		Text: "Second revision", Category: "fun", RelationshipFit: "both", ModeFit: "both", Intensity: "medium",
	}, created.CurrentRevisionID, adminID)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errorsSeen := make(chan error, 2)
	go func() {
		<-start
		_, err := service.Restore(context.Background(), created.ID, created.CurrentRevisionID, second.CurrentRevisionID, adminID)
		errorsSeen <- err
	}()
	go func() {
		<-start
		_, err := service.Edit(context.Background(), created.ID, question.RevisionFields{
			Text: "Edit racing restore", Category: "fun", RelationshipFit: "both", ModeFit: "both", Intensity: "deep",
		}, second.CurrentRevisionID, adminID)
		errorsSeen <- err
	}()
	close(start)
	first, secondErr := <-errorsSeen, <-errorsSeen
	if (first == nil) == (secondErr == nil) {
		t.Fatalf("restore/edit results = %v, %v; want exactly one success", first, secondErr)
	}
	for _, raceErr := range []error{first, secondErr} {
		if raceErr != nil && !errors.Is(raceErr, question.ErrConflict) {
			t.Fatalf("unexpected restore/edit error: %v", raceErr)
		}
	}
	revisions, err := service.ListRevisions(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 3 {
		t.Fatalf("revision count = %d, want 3", len(revisions))
	}
}
