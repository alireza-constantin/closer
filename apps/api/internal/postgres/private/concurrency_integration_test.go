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

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
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

func createMutuallyRevealedRound(t *testing.T, f fixture) (domain.Round, domain.RoundInput, domain.RoundInput) {
	t.Helper()
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	a := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	b := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	for _, input := range []domain.RoundInput{a, b} {
		if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "complete"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, input := range []domain.RoundInput{a, b} {
		if _, err := f.service.Reveal(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	return round, a, b
}

func createReplacementParticipant(t *testing.T, f fixture) string {
	t.Helper()
	var authID, participantID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&authID); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'Replacement') RETURNING id::text", authID).Scan(&participantID)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id = $1", f.pairID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id = $1", participantID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id = $1", authID)
			return nil
		})
	})
	return participantID
}

func replaceSecondMembership(ctx context.Context, f fixture, replacementID string) (string, string, error) {
	var oldMembershipID, newEraID string
	err := f.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var lockedPairID, eraID, firstMembershipID string
		if err := db.QueryRow(ctx, "SELECT id::text FROM pair WHERE id = $1 FOR UPDATE", f.pairID).Scan(&lockedPairID); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, `
			SELECT era.id::text, era.first_membership_id::text, era.second_membership_id::text
			FROM pair_membership_era AS era
			WHERE era.pair_id = $1 AND era.ended_at IS NULL`, f.pairID).Scan(&eraID, &firstMembershipID, &oldMembershipID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership SET ended_at = now(), ended_display_name = 'Second' WHERE id = $1", oldMembershipID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership_era SET ended_at = now() WHERE id = $1", eraID); err != nil {
			return err
		}
		var newMembershipID string
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", f.pairID, replacementID).Scan(&newMembershipID); err != nil {
			return err
		}
		return db.QueryRow(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3) RETURNING id::text", f.pairID, firstMembershipID, newMembershipID).Scan(&newEraID)
	})
	return oldMembershipID, newEraID, err
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

func TestPostRevealReactionReplyAndProgressionGate(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "P-04 next prompt")
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	a := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	b := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: a, Body: "answer a"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: b, Body: "answer b"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "heart"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("pre-reveal reaction error = %v", err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "nice"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("pre-reveal reply error = %v", err)
	}
	if _, err := f.service.Reveal(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)}); !errors.Is(err, domain.ErrProgressionNotReady) {
		t.Fatalf("one-reveal progression error = %v", err)
	}
	if _, err := f.service.Reveal(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: b, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-creator progression error = %v", err)
	}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "heart"}); err != nil {
		t.Fatal(err)
	}
	updated, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "tender"})
	if err != nil || len(updated.Reactions) != 1 || updated.Reactions[0].Value != "tender" || !updated.Reactions[0].IsOwner {
		t.Fatalf("reaction replacement = %+v, err=%v", updated.Reactions, err)
	}
	updated, err = f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "  a short thought  "})
	if err != nil || len(updated.Replies) != 1 || updated.Replies[0].Body != "a short thought" || !updated.Replies[0].IsOwner {
		t.Fatalf("reply upsert = %+v, err=%v", updated.Replies, err)
	}
	updated, err = f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "edited thought"})
	if err != nil || len(updated.Replies) != 1 || updated.Replies[0].Body != "edited thought" {
		t.Fatalf("reply edit = %+v, err=%v", updated.Replies, err)
	}
	if _, err := f.service.RemoveReply(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.RemoveReaction(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	requestID := testUUID(t, f.pool)
	progressInput := domain.ProgressInput{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: requestID}
	first, err := f.service.Progress(context.Background(), progressInput)
	if err != nil || first.Candidate == nil {
		t.Fatalf("progress = %+v, err=%v", first, err)
	}
	retry, err := f.service.Progress(context.Background(), progressInput)
	if err != nil || retry.Candidate == nil || retry.Candidate.ID != first.Candidate.ID {
		t.Fatalf("retry = %+v, first=%+v, err=%v", retry, first, err)
	}
	nonCreator, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: f.secondID, PairID: f.pairID, ConversationID: started.ConversationID})
	if err != nil || nonCreator.State != "WAITING_FOR_CREATOR" || nonCreator.Candidate != nil {
		t.Fatalf("non-creator progression projection = %+v, err=%v", nonCreator, err)
	}
}

func TestAskAnotherAndSomethingElseHaveOneSerializedOutcome(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "Next in same lane")
	createActiveQuestion(t, f, "deep", "Next in another lane")
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	a := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	b := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	for _, input := range []domain.RoundInput{a, b} {
		if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "ready"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, input := range []domain.RoundInput{a, b} {
		if _, err := f.service.Reveal(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	inputs := []domain.ProgressInput{
		{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)},
		{RoundInput: a, Action: "something_else", Category: "deep", ClientRequestID: testUUID(t, f.pool)},
	}
	start := make(chan struct{})
	results := make(chan struct {
		view  domain.View
		err   error
		input domain.ProgressInput
	}, 2)
	for _, input := range inputs {
		go func(input domain.ProgressInput) {
			<-start
			view, err := f.service.Progress(context.Background(), input)
			results <- struct {
				view  domain.View
				err   error
				input domain.ProgressInput
			}{view, err, input}
		}(input)
	}
	close(start)
	first, second := <-results, <-results
	if (first.err == nil) == (second.err == nil) {
		t.Fatalf("progress race should have one winner: first=%+v second=%+v", first, second)
	}
	winner, loser := first, second
	if winner.err != nil {
		winner, loser = second, first
	}
	if !errors.Is(loser.err, domain.ErrProgressionConflict) {
		t.Fatalf("losing progression path error = %v", loser.err)
	}
	if winner.view.Candidate == nil {
		t.Fatalf("winning path did not produce exactly one candidate: %+v", winner.view)
	}
	replayed, err := f.service.Progress(context.Background(), winner.input)
	if err != nil || replayed.Candidate == nil || replayed.Candidate.ID != winner.view.Candidate.ID {
		t.Fatalf("winner retry did not replay the same candidate: view=%+v err=%v", replayed, err)
	}
	if _, err := f.service.Progress(context.Background(), loser.input); !errors.Is(err, domain.ErrProgressionConflict) {
		t.Fatalf("opposite retry should be rejected after the winner is fixed: %v", err)
	}
}

func TestAskAnotherVsAskAnotherCreatesOneNextCandidate(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "Only next candidate")
	round, a, _ := createMutuallyRevealedRound(t, f)
	inputs := []domain.ProgressInput{
		{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)},
		{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)},
	}
	start := make(chan struct{})
	results := make(chan struct {
		view  domain.View
		err   error
		input domain.ProgressInput
	}, 2)
	for _, input := range inputs {
		go func(input domain.ProgressInput) {
			<-start
			view, err := f.service.Progress(context.Background(), input)
			results <- struct {
				view  domain.View
				err   error
				input domain.ProgressInput
			}{view, err, input}
		}(input)
	}
	close(start)
	first, second := <-results, <-results
	if (first.err == nil) == (second.err == nil) {
		t.Fatalf("concurrent Ask another results = %+v / %+v, want one winner", first, second)
	}
	winner, loser := first, second
	if winner.err != nil {
		winner, loser = second, first
	}
	if !errors.Is(loser.err, domain.ErrProgressionConflict) {
		t.Fatalf("losing Ask another error = %v, want progression conflict", loser.err)
	}
	if winner.view.Candidate == nil || winner.view.Candidate.Question.ID == round.QuestionID {
		t.Fatalf("Ask another candidate = %+v, want one unconsumed question", winner.view.Candidate)
	}
	replayed, err := f.service.Progress(context.Background(), winner.input)
	if err != nil || replayed.Candidate == nil || replayed.Candidate.ID != winner.view.Candidate.ID {
		t.Fatalf("winning Ask another retry = %+v, original=%+v, err=%v", replayed, winner.view, err)
	}
	if _, err := f.service.Progress(context.Background(), loser.input); !errors.Is(err, domain.ErrProgressionConflict) {
		t.Fatalf("losing Ask another retry error = %v, want progression conflict", err)
	}
	var unresolvedCandidates, openRounds int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id=$1 AND state='unresolved'", replayed.ConversationID).Scan(&unresolvedCandidates); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_round WHERE pair_id=$1 AND membership_era_id=$2 AND status='open'", f.pairID, round.MembershipEraID).Scan(&openRounds)
	}); err != nil {
		t.Fatal(err)
	}
	if unresolvedCandidates != 1 || openRounds != 0 {
		t.Fatalf("after Ask another race unresolved candidates=%d open rounds=%d", unresolvedCandidates, openRounds)
	}
}

func TestProgressionRacesWithReplacementWithoutCrossingMembershipEras(t *testing.T) {
	for _, action := range []string{"ask_another", "something_else"} {
		t.Run(action, func(t *testing.T) {
			f := openFixture(t)
			createActiveQuestion(t, f, "fun", "Next in the current lane")
			createActiveQuestion(t, f, "deep", "Next in the other lane")
			round, creator, _ := createMutuallyRevealedRound(t, f)
			replacementID := createReplacementParticipant(t, f)
			category := "fun"
			if action == "something_else" {
				category = "deep"
			}
			progressInput := domain.ProgressInput{RoundInput: creator, Action: action, Category: category, ClientRequestID: testUUID(t, f.pool)}
			start := make(chan struct{})
			progressResult := make(chan struct {
				view domain.View
				err  error
			}, 1)
			replacementResult := make(chan error, 1)
			go func() {
				<-start
				view, err := f.service.Progress(context.Background(), progressInput)
				progressResult <- struct {
					view domain.View
					err  error
				}{view, err}
			}()
			go func() {
				<-start
				_, _, err := replaceSecondMembership(context.Background(), f, replacementID)
				replacementResult <- err
			}()
			close(start)
			progressed := <-progressResult
			if err := <-replacementResult; err != nil {
				t.Fatalf("replacement failed: %v", err)
			}
			if progressed.err != nil && !errors.Is(progressed.err, domain.ErrNotFound) {
				t.Fatalf("%s vs replacement error = %v", action, progressed.err)
			}
			if progressed.err == nil && (progressed.view.Candidate == nil || progressed.view.Candidate.Question.Category != category) {
				t.Fatalf("progression winner returned a candidate outside %q: %+v", category, progressed.view)
			}
			var currentEraID string
			var newEraConversations int
			if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
				if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&currentEraID); err != nil {
					return err
				}
				return db.QueryRow(context.Background(), "SELECT count(*) FROM private_conversation WHERE pair_id=$1 AND membership_era_id=$2", f.pairID, currentEraID).Scan(&newEraConversations)
			}); err != nil {
				t.Fatal(err)
			}
			if currentEraID == round.MembershipEraID || newEraConversations != 0 {
				t.Fatalf("replacement era=%s conversations=%d; expected a new era with no candidate side effect", currentEraID, newEraConversations)
			}
			if progressed.err == nil {
				formerEraView, err := f.service.Read(context.Background(), domain.ReadInput{ParticipantID: replacementID, PairID: f.pairID, ConversationID: progressed.view.ConversationID})
				if !errors.Is(err, domain.ErrNotFound) || formerEraView.Candidate != nil {
					t.Fatalf("replacement could read progression from former era: view=%+v err=%v", formerEraView, err)
				}
			}
		})
	}
}

func TestAskAnotherExhaustionDoesNotRecycleConsumedQuestions(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	inputs := []domain.RoundInput{{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}, {ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}}
	for _, input := range inputs {
		if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "done"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, input := range inputs {
		if _, err := f.service.Reveal(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	progress := domain.ProgressInput{RoundInput: inputs[0], Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)}
	view, err := f.service.Progress(context.Background(), progress)
	if err != nil || view.State != "EXHAUSTED" || view.Candidate != nil {
		t.Fatalf("exhausted progression = %+v, err=%v", view, err)
	}
	retry, err := f.service.Progress(context.Background(), progress)
	if err != nil || retry.State != "EXHAUSTED" || retry.Candidate != nil {
		t.Fatalf("exhaustion retry = %+v, err=%v", retry, err)
	}
	var asked int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_question_candidate WHERE conversation_id = $1 AND state = 'asked'", started.ConversationID).Scan(&asked)
	}); err != nil {
		t.Fatal(err)
	}
	if asked != 1 {
		t.Fatalf("asked candidate count = %d, want 1", asked)
	}
}

func TestDeclinedRoundAllowsCreatorOnlyProgression(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "After decline")
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	a := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.Decline(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	requestID := testUUID(t, f.pool)
	if _, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-creator declined progression error = %v", err)
	}
	next, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: requestID})
	if err != nil || next.Candidate == nil || next.Candidate.Question.ID == round.QuestionID {
		t.Fatalf("creator progression after decline = %+v, err=%v", next, err)
	}
}

func TestConcurrentReactionAndReplyWritesKeepOneMembershipRow(t *testing.T) {
	f := openFixture(t)
	round, _, b := createMutuallyRevealedRound(t, f)
	start := make(chan struct{})
	results := make(chan error, 4)
	for _, input := range []domain.ReactionInput{{RoundInput: b, Value: "heart"}, {RoundInput: b, Value: "laugh"}} {
		go func(input domain.ReactionInput) {
			<-start
			_, err := f.service.SetReaction(context.Background(), input)
			results <- err
		}(input)
	}
	for _, body := range []string{"first reply", "second reply"} {
		go func(body string) {
			<-start
			_, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: body})
			results <- err
		}(body)
	}
	close(start)
	for range 4 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	view, err := f.service.GetRound(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Reactions) != 1 || !view.Reactions[0].IsOwner {
		t.Fatalf("reaction rows = %+v", view.Reactions)
	}
	if len(view.Replies) != 1 || !view.Replies[0].IsOwner {
		t.Fatalf("reply rows = %+v", view.Replies)
	}
	var reactionRows, replyRows int
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reaction WHERE round_id = $1", round.ID).Scan(&reactionRows); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_reply WHERE round_id = $1", round.ID).Scan(&replyRows)
	}); err != nil {
		t.Fatal(err)
	}
	if reactionRows != 1 || replyRows != 1 {
		t.Fatalf("stored rows reaction=%d reply=%d", reactionRows, replyRows)
	}
}

func TestReactionAndReplyRacingProgressionRemainOwnedAndVisible(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "Next after interactions")
	round, a, b := createMutuallyRevealedRound(t, f)
	start := make(chan struct{})
	results := make(chan error, 3)
	go func() {
		<-start
		_, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "surprised"})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "still here"})
		results <- err
	}()
	go func() {
		<-start
		_, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: a, Action: "ask_another", Category: "fun", ClientRequestID: testUUID(t, f.pool)})
		results <- err
	}()
	close(start)
	for range 3 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	view, err := f.service.GetRound(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Reactions) != 1 || view.Reactions[0].Value != "surprised" || !view.Reactions[0].IsOwner {
		t.Fatalf("reaction after progression race = %+v", view.Reactions)
	}
	if len(view.Replies) != 1 || view.Replies[0].Body != "still here" || !view.Replies[0].IsOwner {
		t.Fatalf("reply after progression race = %+v", view.Replies)
	}
	if view.ID != round.ID {
		t.Fatalf("mutation returned wrong Round %q", view.ID)
	}
}

func TestReplacementMembershipCannotInheritOrMutateReactionAndReply(t *testing.T) {
	f := openFixture(t)
	round, _, b := createMutuallyRevealedRound(t, f)
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "heart"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "B only"}); err != nil {
		t.Fatal(err)
	}

	replacementID := createReplacementParticipant(t, f)

	var oldMembershipID string
	start := make(chan struct{})
	mutationResults := make(chan error, 2)
	replacementResult := make(chan error, 1)
	go func() {
		<-start
		_, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: b, Value: "laugh"})
		mutationResults <- err
	}()
	go func() {
		<-start
		_, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: b, Body: "B raced replacement"})
		mutationResults <- err
	}()
	go func() {
		<-start
		_, _, err := replaceSecondMembership(context.Background(), f, replacementID)
		replacementResult <- err
	}()
	close(start)
	for range 2 {
		if err := <-mutationResults; err != nil && !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("replacement/reaction/reply race error = %v", err)
		}
	}
	if err := <-replacementResult; err != nil {
		t.Fatalf("replacement operation error = %v", err)
	}
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2", f.pairID, f.secondID).Scan(&oldMembershipID)
	}); err != nil {
		t.Fatal(err)
	}

	replacementInput := domain.RoundInput{ParticipantID: replacementID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: replacementInput, Value: "laugh"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement reaction mutation error = %v, want ErrNotFound", err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: replacementInput, Body: "not inherited"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement reply mutation error = %v, want ErrNotFound", err)
	}
	if _, err := f.service.GetRound(context.Background(), replacementInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement historical Round read error = %v, want ErrNotFound", err)
	}
	var reactionCount, replyCount int
	var reactionMembershipID, replyMembershipID, reactionValue, replyBody string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT membership_id::text, value::text FROM private_reaction WHERE round_id = $1", round.ID).Scan(&reactionMembershipID, &reactionValue); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT membership_id::text, body FROM private_reply WHERE round_id = $1", round.ID).Scan(&replyMembershipID, &replyBody); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reaction WHERE round_id = $1", round.ID).Scan(&reactionCount); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM private_reply WHERE round_id = $1", round.ID).Scan(&replyCount)
	}); err != nil {
		t.Fatal(err)
	}
	if reactionCount != 1 || replyCount != 1 || reactionMembershipID != oldMembershipID || replyMembershipID != oldMembershipID || (reactionValue != "heart" && reactionValue != "laugh") || (replyBody != "B only" && replyBody != "B raced replacement") {
		t.Fatalf("replacement changed old member state: reactions=%d/%s/%s replies=%d/%s/%q", reactionCount, reactionMembershipID, reactionValue, replyCount, replyMembershipID, replyBody)
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

func TestRejoinPreservesPrivateEraAndReplacementCannotReadOldRound(t *testing.T) {
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

	var oldEraID, firstMembershipID, secondMembershipID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&oldEraID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL", f.pairID, f.firstID).Scan(&firstMembershipID); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT id::text FROM pair_membership WHERE pair_id=$1 AND participant_id=$2 AND ended_at IS NULL", f.pairID, f.secondID).Scan(&secondMembershipID)
	}); err != nil {
		t.Fatal(err)
	}

	var reboundAuthID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&reboundAuthID); err != nil {
			return err
		}
		_, err := db.Exec(context.Background(), "UPDATE participant SET auth_user_id=$1 WHERE id=$2", reboundAuthID, f.firstID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "UPDATE participant SET auth_user_id=$1 WHERE id=$2", f.firstAuthID, f.firstID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", reboundAuthID)
			return nil
		})
	})

	rejoined, err := f.service.GetRound(context.Background(), firstInput)
	if err != nil {
		t.Fatalf("rejoined participant lost private round: %v", err)
	}
	if rejoined.MembershipEraID != oldEraID || rejoined.YourAnswer == nil || *rejoined.YourAnswer != "REJOIN-SAFE" {
		t.Fatalf("rejoin changed private projection: %+v, want era %s", rejoined, oldEraID)
	}

	var replacementParticipantID, replacementAuthID, replacementMembershipID, replacementEraID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if _, err := db.Exec(context.Background(), "UPDATE pair_membership_era SET ended_at=now() WHERE id=$1", oldEraID); err != nil {
			return err
		}
		if _, err := db.Exec(context.Background(), "UPDATE pair_membership SET ended_at=now(), ended_display_name='First' WHERE id=$1", firstMembershipID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "INSERT INTO auth_user(id, kind, created_at) VALUES (gen_random_uuid(), 'anonymous', now()) RETURNING id::text").Scan(&replacementAuthID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "INSERT INTO participant(auth_user_id, display_name) VALUES ($1, 'Replacement') RETURNING id::text", replacementAuthID).Scan(&replacementParticipantID); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'first') RETURNING id::text", f.pairID, replacementParticipantID).Scan(&replacementMembershipID); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3) RETURNING id::text", f.pairID, replacementMembershipID, secondMembershipID).Scan(&replacementEraID)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair_membership_era WHERE id=$1", replacementEraID)
			_, _ = db.Exec(context.Background(), "DELETE FROM pair_membership WHERE id=$1", replacementMembershipID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id=$1", replacementParticipantID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", replacementAuthID)
			return nil
		})
	})

	replacementInput := domain.RoundInput{ParticipantID: replacementParticipantID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.GetRound(context.Background(), replacementInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement participant accessed old private round: %v", err)
	}
	secondInput := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.GetRound(context.Background(), secondInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("remaining participant accessed old private round after replacement: %v", err)
	}
}
