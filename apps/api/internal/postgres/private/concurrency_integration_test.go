package private_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	domaininvite "github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresinvite "github.com/alireza-constantin/closer/apps/api/internal/postgres/invite"
	postgresprivate "github.com/alireza-constantin/closer/apps/api/internal/postgres/private"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	domain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
)

func testUUID(t *testing.T, pool *postgres.Pool) string {
	t.Helper()
	var id string
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT gen_random_uuid()::text").Scan(&id)
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func createActiveQuestion(t *testing.T, f fixture, category, text string) string {
	t.Helper()
	created, err := f.questions.Create(context.Background(), question.RevisionFields{Text: text, Category: category, RelationshipFit: "both", ModeFit: "private", Intensity: "light"}, f.adminID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.questions.SetActivity(context.Background(), created.ID, "activate", f.adminID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", created.ID)
			return nil
		})
	})
	return created.ID
}

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

func TestConcurrentDifferentCategoryStartsKeepOneCreatorProvisional(t *testing.T) {
	f := openFixture(t)
	memoriesQuestion, err := f.questions.Create(context.Background(), question.RevisionFields{
		Text: "P-01 memories candidate text", Category: "memories", RelationshipFit: "both", ModeFit: "private", Intensity: "light",
	}, f.adminID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.questions.SetActivity(context.Background(), memoriesQuestion.ID, "activate", f.adminID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", memoriesQuestion.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", memoriesQuestion.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", memoriesQuestion.ID)
			return nil
		})
	})
	start := make(chan struct{})
	results := make(chan domain.View, 2)
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, category := range []string{"fun", "memories"} {
		wait.Add(1)
		go func(category string) {
			defer wait.Done()
			<-start
			view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: category})
			results <- view
			errorsSeen <- err
		}(category)
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatal(err)
		}
	}
	views := make([]domain.View, 0, 2)
	for view := range results {
		views = append(views, view)
	}
	if len(views) != 2 || views[0].ConversationID != views[1].ConversationID {
		t.Fatalf("different category starts stacked provisional candidates: %+v", views)
	}
	var unresolved int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), `SELECT count(*) FROM private_question_candidate AS candidate JOIN private_conversation AS conversation ON conversation.id = candidate.conversation_id WHERE conversation.created_by_participant_id = $1 AND candidate.state = 'unresolved'`, f.firstID).Scan(&unresolved)
	}); err != nil {
		t.Fatal(err)
	}
	if unresolved != 1 {
		t.Fatalf("unresolved creator candidates = %d, want 1", unresolved)
	}
}

func TestAskCreatesOneRoundPinsCandidateRevisionAndKeepsWaitingProjectionSafe(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	requestID := testUUID(t, f.pool)
	asked, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil {
		t.Fatal(err)
	}
	if asked.RoundNumber != 1 || asked.QuestionID != view.Candidate.Question.ID || asked.QuestionRevisionID != view.Candidate.Question.RevisionID || asked.Text != view.Candidate.Question.Text {
		t.Fatalf("asked round lost pinned candidate = %+v / %+v", asked, view.Candidate)
	}
	retry, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil || retry.ID != asked.ID || retry.RoundNumber != asked.RoundNumber {
		t.Fatalf("Ask retry = %+v, err=%v; first=%+v", retry, err, asked)
	}
	creator, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID})
	if err != nil || creator.State != "CURRENT_ROUND" || creator.Candidate != nil || creator.Round == nil {
		t.Fatalf("creator projection = %+v, err=%v", creator, err)
	}
	other, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: f.secondID, PairID: f.pairID, ConversationID: view.ConversationID})
	if err != nil || other.State != "CURRENT_ROUND" || other.Candidate != nil || other.Round == nil || other.Round.Text != asked.Text {
		t.Fatalf("other projection = %+v, err=%v", other, err)
	}
	var rounds, askedCandidates int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE conversation_id = $1", view.ConversationID).Scan(&rounds); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id = $1 AND state = 'asked'", view.ConversationID).Scan(&askedCandidates)
	}); err != nil {
		t.Fatal(err)
	}
	if rounds != 1 || askedCandidates != 1 {
		t.Fatalf("round/candidate counts = %d/%d", rounds, askedCandidates)
	}
}

func TestNormalQuestionEditDoesNotMovePinnedAskRevision(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	originalRevision := view.Candidate.Question.RevisionID
	originalText := view.Candidate.Question.Text
	if _, err := f.questions.Edit(context.Background(), f.questionID, question.RevisionFields{Text: "new current revision", Category: "fun", RelationshipFit: "both", ModeFit: "private", Intensity: "light"}, originalRevision, f.adminID); err != nil {
		t.Fatal(err)
	}
	asked, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	if asked.QuestionRevisionID != originalRevision || asked.Text != originalText {
		t.Fatalf("Ask moved from pinned revision = %+v, want revision=%s text=%q", asked, originalRevision, originalText)
	}
}

func TestSkipIsIdempotentAndConsumesLogicalQuestion(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	requestID := testUUID(t, f.pool)
	first, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil {
		t.Fatal(err)
	}
	if first.Candidate != nil || first.State != "EXHAUSTED" {
		t.Fatalf("single-question skip = %+v", first)
	}
	retry, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil || retry.State != first.State || retry.Candidate != nil {
		t.Fatalf("same-ID skip retry = %+v, err=%v; first=%+v", retry, err, first)
	}
	if _, err := f.questions.Edit(context.Background(), f.questionID, question.RevisionFields{Text: "Edited after skip", Category: "fun", RelationshipFit: "both", ModeFit: "private", Intensity: "light"}, view.Candidate.Question.RevisionID, f.adminID); err != nil {
		t.Fatal(err)
	}
	afterEdit, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || afterEdit.State != "EXHAUSTED" || afterEdit.Candidate != nil {
		t.Fatalf("skipped logical question became eligible after edit = %+v, err=%v", afterEdit, err)
	}
	if _, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: testUUID(t, f.pool)}); !errors.Is(err, domain.ErrCandidate) {
		t.Fatalf("different-ID retry err=%v, want ErrCandidate", err)
	}
}

func TestSkipReturnsStableReplacementOnSameRequest(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "replacement candidate")
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	requestID := testUUID(t, f.pool)
	first, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil || first.Candidate == nil {
		t.Fatalf("first skip = %+v, err=%v", first, err)
	}
	retry, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: requestID})
	if err != nil || retry.Candidate == nil || retry.Candidate.ID != first.Candidate.ID {
		t.Fatalf("replacement retry = %+v, err=%v; first=%+v", retry, err, first)
	}
}

func TestLikeIsCreatorOnlyAndFreezesAfterAsk(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	if _, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.secondID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: true}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-creator Like err=%v, want ErrNotFound", err)
	}
	liked, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: true})
	if err != nil || !liked {
		t.Fatalf("Like = %v, err=%v", liked, err)
	}
	afterLike, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID})
	if err != nil || afterLike.Candidate == nil || !afterLike.Candidate.Liked {
		t.Fatalf("liked candidate projection = %+v, err=%v", afterLike, err)
	}
	if _, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: false}); !errors.Is(err, domain.ErrCandidate) {
		t.Fatalf("late Like err=%v, want ErrCandidate", err)
	}
}

func TestPairWideOpenRoundBlocksAskInAnotherConversation(t *testing.T) {
	f := openFixture(t)
	otherQuestionID := createActiveQuestion(t, f, "memories", "other lane question")
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	var otherConversationID, otherCandidateID, eraID, revisionID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership_era WHERE pair_id = $1 AND ended_at IS NULL", f.pairID).Scan(&eraID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT current_revision_id::text FROM question WHERE id = $1", otherQuestionID).Scan(&revisionID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id) VALUES ($1, 'memories', $2, $3) RETURNING id::text", f.pairID, f.firstID, eraID).Scan(&otherConversationID); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id) VALUES ($1, $2, $3) RETURNING id::text", otherConversationID, otherQuestionID, revisionID).Scan(&otherCandidateID)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: otherConversationID, CandidateID: otherCandidateID}); !errors.Is(err, domain.ErrRoundOpen) {
		t.Fatalf("cross-category Ask err=%v, want ErrRoundOpen", err)
	}
}

func TestConcurrentAskAttemptsCreateOneRoundAndOneTerminalCandidate(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			_, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: testUUID(t, f.pool)})
			results <- err
		}()
	}
	close(start)
	firstErr, secondErr := <-results, <-results
	if firstErr != nil && !errors.Is(firstErr, domain.ErrCandidate) && !errors.Is(firstErr, domain.ErrRoundOpen) || secondErr != nil && !errors.Is(secondErr, domain.ErrCandidate) && !errors.Is(secondErr, domain.ErrRoundOpen) {
		t.Fatalf("Ask race errors = %v / %v", firstErr, secondErr)
	}
	var rounds, terminal int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE conversation_id = $1", view.ConversationID).Scan(&rounds); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id = $1 AND state IN ('asked', 'skipped', 'invalidated')", view.ConversationID).Scan(&terminal)
	}); err != nil {
		t.Fatal(err)
	}
	if rounds != 1 || terminal != 1 {
		t.Fatalf("Ask race persisted rounds/terminal candidates = %d/%d", rounds, terminal)
	}
}

func TestConcurrentAskAndSkipHaveOneTerminalOutcome(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: testUUID(t, f.pool)})
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	for _, err := range []error{firstErr, secondErr} {
		if err != nil && !errors.Is(err, domain.ErrCandidate) && !errors.Is(err, domain.ErrRoundOpen) {
			t.Fatalf("Ask/Skip race error = %v", err)
		}
	}
	var rounds, asked, skipped int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE conversation_id = $1", view.ConversationID).Scan(&rounds); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id = $1 AND state = 'asked'", view.ConversationID).Scan(&asked); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id = $1 AND state = 'skipped'", view.ConversationID).Scan(&skipped)
	}); err != nil {
		t.Fatal(err)
	}
	if rounds+skipped != 1 || asked+skipped != 1 {
		t.Fatalf("Ask/Skip race persisted rounds/asked/skipped = %d/%d/%d", rounds, asked, skipped)
	}
}

func TestConcurrentAskAndWithdrawalNeverCreatesRoundFromInvalidatedCandidate(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.questions.Withdraw(context.Background(), f.questionID, view.Candidate.Question.RevisionID, "race", f.adminID)
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	if firstErr != nil && !errors.Is(firstErr, domain.ErrCandidate) || secondErr != nil && !errors.Is(secondErr, domain.ErrCandidate) {
		// The withdrawal service returns its own domain error on only malformed
		// input; a successful withdrawal is nil and Ask may legitimately win.
		if firstErr != nil || secondErr != nil {
			t.Fatalf("Ask/withdrawal race errors = %v / %v", firstErr, secondErr)
		}
	}
	var state string
	var rounds int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT state::text FROM private_question_candidate WHERE id = $1", view.Candidate.ID).Scan(&state); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE candidate_id = $1", view.Candidate.ID).Scan(&rounds)
	}); err != nil {
		t.Fatal(err)
	}
	if state == "invalidated" && rounds != 0 || state == "asked" && rounds != 1 {
		t.Fatalf("Ask/withdrawal race state/rounds = %s/%d", state, rounds)
	}
}

func TestConcurrentLikeAndAskFreezesLikeAtTheWinningTerminalTransition(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: true})
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	for _, err := range []error{firstErr, secondErr} {
		if err != nil && !errors.Is(err, domain.ErrCandidate) {
			t.Fatalf("Like/Ask race error = %v", err)
		}
	}
	var state string
	var liked bool
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT state::text, liked_at IS NOT NULL FROM private_question_candidate WHERE id = $1", view.Candidate.ID).Scan(&state, &liked); err != nil {
			return err
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if state != "asked" || (!liked && firstErr == nil && secondErr == nil) {
		t.Fatalf("Like/Ask race state/liked = %s/%v", state, liked)
	}
}

func TestConcurrentLikeAndSkipDoesNotMutateAfterSkip(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.service.Skip(context.Background(), domain.SkipInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, ClientRequestID: testUUID(t, f.pool)})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: true})
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	for _, err := range []error{firstErr, secondErr} {
		if err != nil && !errors.Is(err, domain.ErrCandidate) {
			t.Fatalf("Like/Skip race error = %v", err)
		}
	}
	var state string
	var rounds int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT state::text FROM private_question_candidate WHERE id = $1", view.Candidate.ID).Scan(&state); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE pair_id = $1", f.pairID).Scan(&rounds)
	}); err != nil {
		t.Fatal(err)
	}
	if state != "skipped" || rounds != 0 {
		t.Fatalf("Like/Skip race state/rounds = %s/%d", state, rounds)
	}
}

func TestConcurrentLikeAndWithdrawalDoesNotLikeAfterInvalidation(t *testing.T) {
	f := openFixture(t)
	view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || view.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", view, err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.questions.Withdraw(context.Background(), f.questionID, view.Candidate.Question.RevisionID, "race", f.adminID)
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Like(context.Background(), domain.LikeInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID, Liked: true})
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	for _, err := range []error{firstErr, secondErr} {
		if err != nil && !errors.Is(err, domain.ErrCandidate) {
			t.Fatalf("Like/withdrawal race error = %v", err)
		}
	}
	var state string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT state::text FROM private_question_candidate WHERE id = $1", view.Candidate.ID).Scan(&state)
	}); err != nil {
		t.Fatal(err)
	}
	if state != "invalidated" {
		t.Fatalf("Like/withdrawal race state = %s", state)
	}
}

func TestAnswerProjectionIsViewerRelativeAndRevealIsIndependent(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	firstInput := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	secondInput := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: firstInput, Body: "FIRST-SENTINEL"}); err != nil {
		t.Fatal(err)
	}
	first, err := f.service.GetRound(context.Background(), firstInput)
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.service.GetRound(context.Background(), secondInput)
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if first.YourAnswer == nil || *first.YourAnswer != "FIRST-SENTINEL" || strings.Contains(string(firstJSON), "SECOND-SENTINEL") {
		t.Fatalf("first pre-reveal projection = %s", firstJSON)
	}
	if second.YourAnswer != nil || strings.Contains(string(secondJSON), "FIRST-SENTINEL") || second.State != "YOUR_TURN" {
		t.Fatalf("second pre-answer projection = %s", secondJSON)
	}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: secondInput, Body: "SECOND-SENTINEL"}); err != nil {
		t.Fatal(err)
	}
	ready, err := f.service.GetRound(context.Background(), firstInput)
	if err != nil {
		t.Fatal(err)
	}
	readyJSON, _ := json.Marshal(ready)
	if ready.State != "REVEAL_READY" || len(ready.Answers) != 0 || strings.Contains(string(readyJSON), "SECOND-SENTINEL") {
		t.Fatalf("ready projection leaked answer = %s", readyJSON)
	}
	if _, err := f.service.Reveal(context.Background(), firstInput); err != nil {
		t.Fatal(err)
	}
	revealed, err := f.service.GetRound(context.Background(), firstInput)
	if err != nil {
		t.Fatal(err)
	}
	if revealed.State != "REVEAL_VIEWED" || len(revealed.Answers) != 2 {
		t.Fatalf("first reveal projection = %+v", revealed)
	}
	secondBeforeReveal, err := f.service.GetRound(context.Background(), secondInput)
	if err != nil {
		t.Fatal(err)
	}
	secondBeforeJSON, _ := json.Marshal(secondBeforeReveal)
	if len(secondBeforeReveal.Answers) != 0 || strings.Contains(string(secondBeforeJSON), "FIRST-SENTINEL") {
		t.Fatalf("second received answer before own Reveal = %s", secondBeforeJSON)
	}
	if _, err := f.service.Reveal(context.Background(), secondInput); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Reveal(context.Background(), secondInput); err != nil {
		t.Fatal(err)
	}
	var revealViews int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_reveal_view WHERE round_id = $1", round.ID).Scan(&revealViews)
	}); err != nil {
		t.Fatal(err)
	}
	if revealViews != 2 {
		t.Fatalf("reveal views = %d, want 2", revealViews)
	}
	final, err := f.service.GetRound(context.Background(), firstInput)
	if err != nil {
		t.Fatal(err)
	}
	if !final.CanContinue {
		t.Fatalf("both Reveal Views did not unlock progression: %+v", final)
	}
}

func TestConcurrentAnswersBothCommitWithoutCrossViewerLeak(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, input := range []domain.AnswerInput{
		{RoundInput: domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}, Body: "CONCURRENT-FIRST"},
		{RoundInput: domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}, Body: "CONCURRENT-SECOND"},
	} {
		go func(input domain.AnswerInput) {
			<-start
			_, answerErr := f.service.Answer(context.Background(), input)
			results <- answerErr
		}(input)
	}
	close(start)
	if firstErr, secondErr := <-results, <-results; firstErr != nil || secondErr != nil {
		t.Fatalf("concurrent answers errors = %v / %v", firstErr, secondErr)
	}

	first, err := f.service.GetRound(context.Background(), domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.service.GetRound(context.Background(), domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID})
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if first.State != "REVEAL_READY" || first.YourAnswer == nil || *first.YourAnswer != "CONCURRENT-FIRST" || len(first.Answers) != 0 || strings.Contains(string(firstJSON), "CONCURRENT-SECOND") {
		t.Fatalf("first concurrent projection = %s", firstJSON)
	}
	if second.State != "REVEAL_READY" || second.YourAnswer == nil || *second.YourAnswer != "CONCURRENT-SECOND" || len(second.Answers) != 0 || strings.Contains(string(secondJSON), "CONCURRENT-FIRST") {
		t.Fatalf("second concurrent projection = %s", secondJSON)
	}
}

func TestAnswerIsImmutableAndDeclineAnswerRaceHasOneTerminalOutcome(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	input := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "IMMUTABLE"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "different"}); !errors.Is(err, domain.ErrAnswerImmutable) {
		t.Fatalf("changed answer err = %v, want ErrAnswerImmutable", err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}, Body: "RACING"})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Decline(context.Background(), domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID})
		results <- err
	}()
	close(start)
	firstErr, secondErr := <-results, <-results
	if (firstErr == nil) == (secondErr == nil) {
		t.Fatalf("answer/decline race errors = %v / %v, want one winner", firstErr, secondErr)
	}
	var status string
	var answerCount int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT status::text FROM private_round WHERE id = $1", round.ID).Scan(&status); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_answer WHERE round_id = $1", round.ID).Scan(&answerCount)
	}); err != nil {
		t.Fatal(err)
	}
	if status == "retired" && answerCount != 1 || status == "open" && answerCount != 2 {
		t.Fatalf("race persisted status=%s answers=%d", status, answerCount)
	}
}

func TestGuestRejoinClosesEraAndReplacementCannotAccessOldPrivateOrTogetherState(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	firstInput := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: firstInput, Body: "REJOIN-SAFE"}); err != nil {
		t.Fatal(err)
	}
	secondInput := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: secondInput, Body: "SECOND-ERA-ANSWER"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Reveal(context.Background(), firstInput); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Reveal(context.Background(), secondInput); err != nil {
		t.Fatal(err)
	}
	deepQuestionID := createActiveQuestion(t, f, "deep", "Rejoin candidate invalidation")

	var oldEraID, firstMembershipID, secondMembershipID, togetherSessionID, oldCandidateID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&oldEraID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL", f.pairID, f.firstID).Scan(&firstMembershipID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL", f.pairID, f.secondID).Scan(&secondMembershipID); err != nil {
			return err
		}
		var oldConversationID, deepRevisionID string
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM private_conversation WHERE pair_id=$1 AND membership_era_id=$2 AND category='fun'", f.pairID, oldEraID).Scan(&oldConversationID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT current_revision_id::text FROM question WHERE id=$1", deepQuestionID).Scan(&deepRevisionID); err != nil {
			return err
		}
		var candidateConversationID string
		if err := db.QueryRow(context.Background(), `INSERT INTO private_conversation(pair_id, category, created_by_participant_id, membership_era_id)
			VALUES ($1, 'deep', $2, $3) RETURNING id::text`, f.pairID, f.firstID, oldEraID).Scan(&candidateConversationID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), `INSERT INTO private_question_candidate(conversation_id, question_id, question_revision_id)
			VALUES ($1, $2, $3) RETURNING id::text`, candidateConversationID, deepQuestionID, deepRevisionID).Scan(&oldCandidateID); err != nil {
			return err
		}
		if oldConversationID == candidateConversationID {
			return errors.New("expected a distinct unresolved-candidate Conversation")
		}
		return db.QueryRow(context.Background(), `INSERT INTO together_session(pair_id, membership_era_id, category, started_by_participant_id, start_request_id, selection_seed)
			VALUES ($1, $2, 'fun', $3, gen_random_uuid(), 'rejoin-active-session') RETURNING id::text`, f.pairID, oldEraID, f.firstID).Scan(&togetherSessionID)
	}); err != nil {
		t.Fatal(err)
	}

	var replacementAuthID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&replacementAuthID)
	}); err != nil {
		t.Fatal(err)
	}
	rejoinService := domaininvite.NewService(postgresinvite.NewStore(f.pool))
	issued, err := rejoinService.IssueRejoin(context.Background(), f.secondID, f.pairID)
	if err != nil {
		t.Fatalf("issue replacement credential: %v", err)
	}
	rejoined, err := rejoinService.Rejoin(context.Background(), issued.Token, replacementAuthID, "Replacement")
	if err != nil {
		t.Fatalf("redeem replacement credential: %v", err)
	}
	replacementParticipantID, replacementEraID := rejoined.ParticipantID, rejoined.MembershipEraID
	var replacementMembershipID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL", f.pairID, replacementParticipantID).Scan(&replacementMembershipID)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id=$1", f.pairID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id=$1", replacementParticipantID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", replacementAuthID)
			return nil
		})
	})
	var endedAt bool
	var candidateState string
	var revealViews, replacementRevealViews int
	var oldAuthOwner, oldConversationCreator string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT ended_at IS NOT NULL FROM together_session WHERE id=$1", togetherSessionID).Scan(&endedAt); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT state FROM private_question_candidate WHERE id=$1", oldCandidateID).Scan(&candidateState); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reveal_view WHERE round_id=$1 AND membership_era_id=$2", round.ID, oldEraID).Scan(&revealViews); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reveal_view WHERE round_id=$1 AND membership_id=$2", round.ID, replacementMembershipID).Scan(&replacementRevealViews); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT auth_user_id::text FROM participant WHERE id=$1", f.firstID).Scan(&oldAuthOwner); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT created_by_participant_id::text FROM private_conversation WHERE id=$1", started.ConversationID).Scan(&oldConversationCreator)
	}); err != nil {
		t.Fatal(err)
	}
	if !endedAt || candidateState != "invalidated" || revealViews != 2 || replacementRevealViews != 0 || oldAuthOwner != f.firstAuthID || oldConversationCreator != f.firstID {
		t.Fatalf("replacement state: togetherEnded=%v candidate=%s oldRevealViews=%d newRevealViews=%d oldAuthOwner=%s oldCreator=%s", endedAt, candidateState, revealViews, replacementRevealViews, oldAuthOwner, oldConversationCreator)
	}

	replacementInput := domain.RoundInput{ParticipantID: replacementParticipantID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.GetRound(context.Background(), replacementInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement participant accessed old private round: %v", err)
	}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: replacementInput, Body: "FORBIDDEN"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement mutated old Private Round: %v", err)
	}
	future, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: replacementParticipantID, PairID: f.pairID, Category: "fun"})
	if err != nil || future.Candidate == nil || future.ConversationID == started.ConversationID || future.CreatorParticipantID != replacementParticipantID {
		t.Fatalf("replacement could not begin future Private work: %+v err=%v", future, err)
	}
	futureRound, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: replacementParticipantID, PairID: f.pairID, ConversationID: future.ConversationID, CandidateID: future.Candidate.ID})
	if err != nil || futureRound.RoundNumber != 1 || futureRound.MembershipEraID != replacementEraID {
		t.Fatalf("replacement future Round = %+v err=%v", futureRound, err)
	}
}

func TestGuestRejoinSerializesWithPairTermination(t *testing.T) {
	f := openFixture(t)
	rejoinService := domaininvite.NewService(postgresinvite.NewStore(f.pool))
	issued, err := rejoinService.IssueRejoin(context.Background(), f.secondID, f.pairID)
	if err != nil {
		t.Fatalf("issue replacement credential: %v", err)
	}
	var replacementAuthID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&replacementAuthID)
	}); err != nil {
		t.Fatal(err)
	}
	var replacementParticipantID string
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id=$1", f.pairID)
			if replacementParticipantID != "" {
				_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id=$1", replacementParticipantID)
			}
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", replacementAuthID)
			return nil
		})
	})
	start := make(chan struct{})
	type result struct {
		operation string
		err       error
	}
	results := make(chan result, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		rejoined, err := rejoinService.Rejoin(context.Background(), issued.Token, replacementAuthID, "Replacement")
		if err == nil {
			replacementParticipantID = rejoined.ParticipantID
		}
		results <- result{operation: "rejoin", err: err}
	}()
	go func() {
		defer wait.Done()
		<-start
		err := f.pool.WithinTx(context.Background(), func(db postgres.QueryDB) error {
			var lockedPair string
			if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair WHERE id=$1 FOR UPDATE", f.pairID).Scan(&lockedPair); err != nil {
				return err
			}
			if _, err := db.Exec(context.Background(), "UPDATE pair SET terminated_at=clock_timestamp() WHERE id=$1 AND terminated_at IS NULL", f.pairID); err != nil {
				return err
			}
			if _, err := db.Exec(context.Background(), "UPDATE pair_membership_era SET ended_at=COALESCE(ended_at, clock_timestamp()) WHERE pair_id=$1", f.pairID); err != nil {
				return err
			}
			if _, err := db.Exec(context.Background(), `UPDATE pair_membership AS membership
				SET ended_at=COALESCE(membership.ended_at, clock_timestamp()),
				    ended_display_name=COALESCE(membership.ended_display_name, participant.display_name)
				FROM participant WHERE membership.participant_id=participant.id AND membership.pair_id=$1`, f.pairID); err != nil {
				return err
			}
			_, err := db.Exec(context.Background(), "UPDATE rejoin_invite SET revoked_at=clock_timestamp() WHERE pair_id=$1 AND redeemed_at IS NULL AND revoked_at IS NULL", f.pairID)
			return err
		})
		results <- result{operation: "terminate", err: err}
	}()
	close(start)
	wait.Wait()
	close(results)
	rejoinWon := false
	for outcome := range results {
		if outcome.operation == "rejoin" {
			switch {
			case outcome.err == nil:
				rejoinWon = true
			case errors.Is(outcome.err, domaininvite.ErrRejoinUnavailable):
			default:
				t.Fatalf("rejoin race failed unexpectedly: %v", outcome.err)
			}
		} else if outcome.operation == "terminate" && outcome.err != nil {
			t.Fatalf("termination race failed: %v", outcome.err)
		}
	}
	var terminated bool
	var activeMemberships, activeEras, memberships, eras int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT terminated_at IS NOT NULL FROM pair WHERE id=$1", f.pairID).Scan(&terminated); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&activeMemberships); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&activeEras); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership WHERE pair_id=$1", f.pairID).Scan(&memberships); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership_era WHERE pair_id=$1", f.pairID).Scan(&eras)
	}); err != nil {
		t.Fatal(err)
	}
	wantMemberships, wantEras := 2, 1
	if rejoinWon {
		wantMemberships++
		wantEras++
	}
	if !terminated || activeMemberships != 0 || activeEras != 0 || memberships != wantMemberships || eras != wantEras {
		t.Fatalf("termination/rejoin final state: terminated=%v active=%d/%d totals=%d/%d want=%d/%d", terminated, activeMemberships, activeEras, memberships, eras, wantMemberships, wantEras)
	}
}
