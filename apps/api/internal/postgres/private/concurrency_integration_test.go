package private_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	domaininvite "github.com/alireza-constantin/closer/apps/api/internal/invite"
	domainpair "github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresinvite "github.com/alireza-constantin/closer/apps/api/internal/postgres/invite"
	postgrespair "github.com/alireza-constantin/closer/apps/api/internal/postgres/pair"
	postgresprivate "github.com/alireza-constantin/closer/apps/api/internal/postgres/private"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	postgrestogether "github.com/alireza-constantin/closer/apps/api/internal/postgres/together"
	domain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	domaintogether "github.com/alireza-constantin/closer/apps/api/internal/together"
	"github.com/jackc/pgx/v5"
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

func createActiveTogetherQuestion(t *testing.T, f fixture, text string) string {
	t.Helper()
	created, err := f.questions.Create(context.Background(), question.RevisionFields{
		Text: text, Category: "fun", RelationshipFit: "both", ModeFit: "together", Intensity: "light",
	}, f.adminID)
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

func racePairMutationWithTermination(t *testing.T, f fixture, participantID string, notFound error, mutate func() error) error {
	t.Helper()
	terminationService := domainpair.NewService(postgrespair.NewStore(f.pool))
	start := make(chan struct{})
	ready := make(chan struct{}, 2)
	type outcome struct {
		operation string
		err       error
	}
	results := make(chan outcome, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		ready <- struct{}{}
		<-start
		results <- outcome{operation: "mutation", err: mutate()}
	}()
	go func() {
		defer wait.Done()
		ready <- struct{}{}
		<-start
		_, err := terminationService.Terminate(context.Background(), participantID, f.pairID)
		results <- outcome{operation: "termination", err: err}
	}()
	<-ready
	<-ready
	close(start)
	wait.Wait()
	close(results)
	var mutationErr error
	for result := range results {
		if result.operation == "mutation" {
			mutationErr = result.err
		} else if result.err != nil {
			t.Fatalf("termination race command failed: %v", result.err)
		}
	}
	if mutationErr != nil && !errors.Is(mutationErr, notFound) {
		t.Fatalf("racing mutation failed with unexpected error: %v", mutationErr)
	}
	var terminated bool
	var activeMemberships, activeEras, activeSessions, unresolvedCandidates, usableInitialInvites, usableRejoinInvites int
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
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM together_session WHERE pair_id=$1 AND ended_at IS NULL", f.pairID).Scan(&activeSessions); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), `SELECT count(*) FROM private_question_candidate candidate
			JOIN private_conversation conversation ON conversation.id=candidate.conversation_id
			WHERE conversation.pair_id=$1 AND candidate.state='unresolved'`, f.pairID).Scan(&unresolvedCandidates); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM initial_invite WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL", f.pairID).Scan(&usableInitialInvites); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM rejoin_invite WHERE pair_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL", f.pairID).Scan(&usableRejoinInvites)
	}); err != nil {
		t.Fatal(err)
	}
	if !terminated || activeMemberships != 0 || activeEras != 0 || activeSessions != 0 || unresolvedCandidates != 0 || usableInitialInvites != 0 || usableRejoinInvites != 0 {
		t.Fatalf("race ended in partial state: terminated=%v memberships=%d eras=%d sessions=%d candidates=%d initialInvites=%d rejoinInvites=%d", terminated, activeMemberships, activeEras, activeSessions, unresolvedCandidates, usableInitialInvites, usableRejoinInvites)
	}
	return mutationErr
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

func TestHistoryKeepsMembershipEraPrivateAfterReplacement(t *testing.T) {
	f := openFixture(t)
	round, _, second := createMutuallyRevealedRound(t, f)
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, err := db.Exec(context.Background(), `UPDATE private_answer SET body = CASE participant_id WHEN $1 THEN 'A_SECRET_ERA1' ELSE 'B_SECRET_ERA1' END WHERE round_id = $2`, f.firstID, round.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: second, Value: "heart"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: second, Body: "B_REPLY_ERA1"}); err != nil {
		t.Fatal(err)
	}
	currentQuestion, err := f.questions.Get(context.Background(), f.questionID)
	if err != nil {
		t.Fatal(err)
	}
	updatedQuestion, err := f.questions.Edit(context.Background(), f.questionID, question.RevisionFields{Text: "P-05 later wording", Category: "fun", RelationshipFit: "both", ModeFit: "private", Intensity: "light"}, currentQuestion.CurrentRevisionID, f.adminID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.questions.Withdraw(context.Background(), f.questionID, updatedQuestion.CurrentRevisionID, "after it was asked", f.adminID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}, ClientRequestID: testUUID(t, f.pool), Action: "something_else", Category: "deep"}); err != nil {
		t.Fatal(err)
	}
	replacementID := createReplacementParticipant(t, f)
	if _, _, err := replaceSecondMembership(context.Background(), f, replacementID); err != nil {
		t.Fatal(err)
	}

	replacementHistory, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: replacementID, PairID: f.pairID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	oldEraCursor := base64.RawURLEncoding.EncodeToString([]byte(f.pairID + "|2099-01-01T00:00:00Z|" + round.ID))
	oldEraPage, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: replacementID, PairID: f.pairID, Cursor: oldEraCursor, Limit: 20})
	if err != nil || len(oldEraPage.Rounds) != 0 {
		t.Fatalf("replacement cursor crossed membership eras: %+v, err=%v", oldEraPage, err)
	}
	serialized, err := json.Marshal(replacementHistory)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"A_SECRET_ERA1", "B_SECRET_ERA1", "B_REPLY_ERA1", "heart"} {
		if strings.Contains(string(serialized), secret) {
			t.Fatalf("replacement history leaked %q: %s", secret, serialized)
		}
	}
	if len(replacementHistory.Rounds) != 0 {
		t.Fatalf("replacement inherited historical rounds: %+v", replacementHistory)
	}

	continuingHistory, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: f.pairID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	continuingJSON, _ := json.Marshal(continuingHistory)
	if !strings.Contains(string(continuingJSON), "B_SECRET_ERA1") || !strings.Contains(string(continuingJSON), "B_REPLY_ERA1") || !strings.Contains(string(continuingJSON), "Second") {
		t.Fatalf("continuing member history lost the exact era projection or old display name: %s", continuingJSON)
	}
	if len(continuingHistory.Rounds) != 1 || continuingHistory.Rounds[0].Text != "P-01 candidate text" || continuingHistory.Rounds[0].Category != "fun" {
		t.Fatalf("historical Round changed with a later edit, withdrawal, or lane change: %+v", continuingHistory.Rounds)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: domain.RoundInput{ParticipantID: replacementID, PairID: f.pairID, RoundID: round.ID}, Body: "cannot mutate old era"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement mutation error = %v, want not found", err)
	}
	formerHistory, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.secondID, PairID: f.pairID, Limit: 20})
	if err != nil || len(formerHistory.Rounds) != 1 {
		t.Fatalf("former member read-only history = %+v, err=%v", formerHistory, err)
	}
}

func TestHistoryKeysetPaginationIsStableAndComplete(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "fun", "Second chronological prompt")
	createActiveQuestion(t, f, "fun", "Third chronological prompt")
	firstRound, _, firstSecond := createMutuallyRevealedRound(t, f)
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: firstSecond, Body: "B_REPLY_CURSOR_SECRET"}); err != nil {
		t.Fatal(err)
	}
	rounds := []domain.Round{firstRound}
	previous := firstRound
	for index := 0; index < 2; index++ {
		progressed, err := f.service.Progress(context.Background(), domain.ProgressInput{RoundInput: domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: previous.ID}, ClientRequestID: testUUID(t, f.pool), Action: "ask_another", Category: "fun"})
		if err != nil || progressed.Candidate == nil {
			t.Fatalf("progress to next candidate = %+v, err=%v", progressed, err)
		}
		round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: progressed.ConversationID, CandidateID: progressed.Candidate.ID})
		if err != nil {
			t.Fatal(err)
		}
		for _, participantID := range []string{f.firstID, f.secondID} {
			input := domain.RoundInput{ParticipantID: participantID, PairID: f.pairID, RoundID: round.ID}
			if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "pagination answer"}); err != nil {
				t.Fatal(err)
			}
		}
		for _, participantID := range []string{f.firstID, f.secondID} {
			input := domain.RoundInput{ParticipantID: participantID, PairID: f.pairID, RoundID: round.ID}
			if _, err := f.service.Reveal(context.Background(), input); err != nil {
				t.Fatal(err)
			}
		}
		rounds = append(rounds, round)
		previous = round
	}

	var paged []domain.HistoryRound
	cursor := ""
	for pageNumber := 0; pageNumber < 4; pageNumber++ {
		page, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: f.pairID, Cursor: cursor, Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		paged = append(paged, page.Rounds...)
		if pageNumber == 0 && page.NextCursor == "" {
			t.Fatal("first history page did not return a cursor")
		}
		if pageNumber == 0 {
			decodedCursor, err := base64.RawURLEncoding.DecodeString(page.NextCursor)
			if err != nil {
				t.Fatalf("decode history cursor: %v", err)
			}
			if strings.Contains(string(decodedCursor), "pagination answer") || strings.Contains(string(decodedCursor), "B_REPLY_CURSOR_SECRET") {
				t.Fatalf("history cursor contains private answer or reply content: %q", decodedCursor)
			}
			foreignPairID := testUUID(t, f.pool)
			_, err = f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: foreignPairID, Cursor: page.NextCursor, Limit: 1})
			if !errors.Is(err, domain.ErrHistoryCursor) {
				t.Fatalf("cross-Pair history cursor error = %v, want invalid cursor", err)
			}
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(paged) != 3 {
		t.Fatalf("history pagination returned %d rounds, want 3", len(paged))
	}
	seen := map[string]bool{}
	for _, item := range paged {
		if seen[item.ID] {
			t.Fatalf("history pagination duplicated Round %s", item.ID)
		}
		seen[item.ID] = true
	}
	for _, round := range rounds {
		if !seen[round.ID] {
			t.Fatalf("history pagination omitted Round %s", round.ID)
		}
	}
	for index := 1; index < len(paged); index++ {
		if paged[index-1].AskedAt < paged[index].AskedAt {
			t.Fatalf("history is not newest first: %+v", paged)
		}
	}
}

func TestRetiredRoundDoesNotBecomePairedAnswerHistory(t *testing.T) {
	f := openFixture(t)
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Decline(context.Background(), domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}); err != nil {
		t.Fatal(err)
	}
	page, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: f.pairID, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rounds) != 0 {
		t.Fatalf("retired Round appeared as paired history: %+v", page.Rounds)
	}
}

func TestHistoryReadsObserveCommittedSnapshotsAcrossMutationReplacementAndCompletion(t *testing.T) {
	f := openFixture(t)
	_, _, second := createMutuallyRevealedRound(t, f)
	start := make(chan struct{})
	var read domain.HistoryPage
	var readErr error
	var mutationErr error
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		read, readErr = f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: f.pairID, Limit: 20})
	}()
	go func() {
		defer wait.Done()
		<-start
		_, mutationErr = f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: second, Body: "committed while history reads"})
	}()
	close(start)
	wait.Wait()
	if readErr != nil || mutationErr != nil {
		t.Fatalf("history/read and reply race errors: %v / %v", readErr, mutationErr)
	}
	if len(read.Rounds) != 1 || len(read.Rounds[0].Answers) != 2 || len(read.Rounds[0].Replies) > 1 {
		t.Fatalf("history/reply race returned an invalid projection: %+v", read)
	}

	replacementID := createReplacementParticipant(t, f)
	start = make(chan struct{})
	var replacementRead domain.HistoryPage
	var replacementReadErr, replacementErr error
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		replacementRead, replacementReadErr = f.service.History(context.Background(), domain.HistoryInput{ParticipantID: replacementID, PairID: f.pairID, Limit: 20})
	}()
	go func() {
		defer wait.Done()
		<-start
		_, _, replacementErr = replaceSecondMembership(context.Background(), f, replacementID)
	}()
	close(start)
	wait.Wait()
	if replacementErr != nil {
		t.Fatal(replacementErr)
	}
	if replacementReadErr != nil && !errors.Is(replacementReadErr, domain.ErrNotFound) {
		t.Fatalf("replacement history race error = %v", replacementReadErr)
	}
	if len(replacementRead.Rounds) != 0 {
		t.Fatalf("replacement history race inherited prior-era content: %+v", replacementRead)
	}

	// Completion and its second Reveal commit atomically with their visibility
	// transition. A racing history read may see neither Round or the full pair.
	g := openFixture(t)
	started, err := g.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: g.firstID, PairID: g.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start next Round = %+v, err=%v", started, err)
	}
	openRound, err := g.service.Ask(context.Background(), domain.AskInput{ParticipantID: g.firstID, PairID: g.pairID, ConversationID: started.ConversationID, CandidateID: started.Candidate.ID})
	if err != nil {
		t.Fatal(err)
	}
	for _, participantID := range []string{g.firstID, g.secondID} {
		input := domain.RoundInput{ParticipantID: participantID, PairID: g.pairID, RoundID: openRound.ID}
		if _, err := g.service.Answer(context.Background(), domain.AnswerInput{RoundInput: input, Body: "concurrent completion"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := g.service.Reveal(context.Background(), domain.RoundInput{ParticipantID: g.firstID, PairID: g.pairID, RoundID: openRound.ID}); err != nil {
		t.Fatal(err)
	}
	start = make(chan struct{})
	var completionRead domain.HistoryPage
	var completionReadErr, revealErr error
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		completionRead, completionReadErr = g.service.History(context.Background(), domain.HistoryInput{ParticipantID: g.firstID, PairID: g.pairID, Limit: 20})
	}()
	go func() {
		defer wait.Done()
		<-start
		_, revealErr = g.service.Reveal(context.Background(), domain.RoundInput{ParticipantID: g.secondID, PairID: g.pairID, RoundID: openRound.ID})
	}()
	close(start)
	wait.Wait()
	if completionReadErr != nil || revealErr != nil {
		t.Fatalf("history/read and final Reveal race errors: %v / %v", completionReadErr, revealErr)
	}
	if len(completionRead.Rounds) > 1 {
		t.Fatalf("history/final Reveal race returned %d rounds, want zero or one complete Round", len(completionRead.Rounds))
	}
	for _, item := range completionRead.Rounds {
		if len(item.Answers) != 2 {
			t.Fatalf("history/final Reveal race returned partial answers: %+v", item)
		}
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
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: secondInput, Value: "heart"}); err != nil {
		t.Fatalf("former guest reaction: %v", err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: secondInput, Body: "OLD-ERA-REPLY"}); err != nil {
		t.Fatalf("former guest reply: %v", err)
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
	var oldAnswerCount, newAnswerCount, oldReactionCount, newReactionCount, oldReplyCount, newReplyCount int
	var oldReaction, oldReply string
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
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_answer WHERE round_id=$1 AND membership_id=$2", round.ID, secondMembershipID).Scan(&oldAnswerCount); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_answer WHERE round_id=$1 AND membership_id=$2", round.ID, replacementMembershipID).Scan(&newAnswerCount); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*), COALESCE(max(value::text), '') FROM private_reaction WHERE round_id=$1 AND membership_id=$2", round.ID, secondMembershipID).Scan(&oldReactionCount, &oldReaction); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reaction WHERE round_id=$1 AND membership_id=$2", round.ID, replacementMembershipID).Scan(&newReactionCount); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*), COALESCE(max(body), '') FROM private_reply WHERE round_id=$1 AND membership_id=$2", round.ID, secondMembershipID).Scan(&oldReplyCount, &oldReply); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM private_reply WHERE round_id=$1 AND membership_id=$2", round.ID, replacementMembershipID).Scan(&newReplyCount); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), "SELECT auth_user_id::text FROM participant WHERE id=$1", f.firstID).Scan(&oldAuthOwner); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT created_by_participant_id::text FROM private_conversation WHERE id=$1", started.ConversationID).Scan(&oldConversationCreator)
	}); err != nil {
		t.Fatal(err)
	}
	if replacementParticipantID == f.secondID || replacementMembershipID == secondMembershipID || replacementEraID == oldEraID || !endedAt || candidateState != "invalidated" || revealViews != 2 || replacementRevealViews != 0 || oldAnswerCount != 1 || newAnswerCount != 0 || oldReactionCount != 1 || oldReaction != "heart" || newReactionCount != 0 || oldReplyCount != 1 || oldReply != "OLD-ERA-REPLY" || newReplyCount != 0 || oldAuthOwner != f.firstAuthID || oldConversationCreator != f.firstID {
		t.Fatalf("replacement state: participant=%s/%s membership=%s/%s era=%s/%s togetherEnded=%v candidate=%s oldRevealViews=%d newRevealViews=%d answers=%d newAnswers=%d reactions=%d/%q newReactions=%d replies=%d/%q newReplies=%d oldAuthOwner=%s oldCreator=%s", replacementParticipantID, f.secondID, replacementMembershipID, secondMembershipID, replacementEraID, oldEraID, endedAt, candidateState, revealViews, replacementRevealViews, oldAnswerCount, newAnswerCount, oldReactionCount, oldReaction, newReactionCount, oldReplyCount, oldReply, newReplyCount, oldAuthOwner, oldConversationCreator)
	}

	replacementInput := domain.RoundInput{ParticipantID: replacementParticipantID, PairID: f.pairID, RoundID: round.ID}
	if _, err := f.service.GetRound(context.Background(), replacementInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement participant accessed old private round: %v", err)
	}
	if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: replacementInput, Body: "FORBIDDEN"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement mutated old Private Round: %v", err)
	}
	if _, err := f.service.Reveal(context.Background(), replacementInput); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement revealed old Private Round: %v", err)
	}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: replacementInput, Value: "laugh"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement mutated former guest reaction: %v", err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: replacementInput, Body: "INHERITED"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("replacement mutated former guest reply: %v", err)
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
	terminationService := domainpair.NewService(postgrespair.NewStore(f.pool))
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
		_, err := terminationService.Terminate(context.Background(), f.secondID, f.pairID)
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

func TestFormerReplacementEraParticipantCannotTerminateActivePair(t *testing.T) {
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
	rejoined, err := rejoinService.Rejoin(context.Background(), issued.Token, replacementAuthID, "Replacement")
	if err != nil {
		t.Fatalf("replace former member: %v", err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id=$1", f.pairID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id=$1", rejoined.ParticipantID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", replacementAuthID)
			return nil
		})
	})

	terminationService := domainpair.NewService(postgrespair.NewStore(f.pool))
	if _, err := terminationService.Terminate(context.Background(), f.firstID, f.pairID); !errors.Is(err, domainpair.ErrPairNotFound) {
		t.Fatalf("former replacement-era member termination error = %v, want Pair not found", err)
	}
	if _, err := terminationService.Terminate(context.Background(), f.secondID, f.pairID); err != nil {
		t.Fatalf("current member termination: %v", err)
	}
}

func TestPairTerminationInvalidatesCandidateAndPreservesFormerPrivateHistory(t *testing.T) {
	f := openFixture(t)
	createActiveQuestion(t, f, "deep", "Unresolved Deep candidate")
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{
		ParticipantID: f.firstID, PairID: f.pairID, Category: "fun",
	})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start completed-history conversation = %+v err=%v", started, err)
	}
	unresolvedForSecond, err := f.service.StartOrResume(context.Background(), domain.StartInput{
		ParticipantID: f.secondID, PairID: f.pairID, Category: "deep",
	})
	if err != nil || unresolvedForSecond.Candidate == nil {
		t.Fatalf("start second-member unresolved conversation = %+v err=%v", unresolvedForSecond, err)
	}
	round, err := f.service.Ask(context.Background(), domain.AskInput{
		ParticipantID: f.firstID, PairID: f.pairID,
		ConversationID: started.ConversationID, CandidateID: started.Candidate.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	firstAnswer := domain.RoundInput{ParticipantID: f.firstID, PairID: f.pairID, RoundID: round.ID}
	secondAnswer := domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}
	for _, answer := range []struct {
		input domain.RoundInput
		body  string
	}{
		{input: firstAnswer, body: "First member's completed answer"},
		{input: secondAnswer, body: "Second member's completed answer"},
	} {
		if _, err := f.service.Answer(context.Background(), domain.AnswerInput{RoundInput: answer.input, Body: answer.body}); err != nil {
			t.Fatal(err)
		}
	}
	for _, reveal := range []domain.RoundInput{firstAnswer, secondAnswer} {
		if _, err := f.service.Reveal(context.Background(), reveal); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: secondAnswer, Value: "heart"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: secondAnswer, Body: "Completed history reply"}); err != nil {
		t.Fatal(err)
	}

	terminationService := domainpair.NewService(postgrespair.NewStore(f.pool))
	if _, err := terminationService.Terminate(context.Background(), f.firstID, f.pairID); err != nil {
		t.Fatalf("terminate Pair: %v", err)
	}
	var candidateState string
	var revisionStillPinned bool
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT state::text FROM private_question_candidate WHERE id=$1", unresolvedForSecond.Candidate.ID).Scan(&candidateState); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT question_revision_id=$2 FROM private_round WHERE id=$1", round.ID, round.QuestionRevisionID).Scan(&revisionStillPinned)
	}); err != nil {
		t.Fatal(err)
	}
	if candidateState != "invalidated" || !revisionStillPinned {
		t.Fatalf("termination candidate/revision state = %q/%v", candidateState, revisionStillPinned)
	}
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		var frozenMemberships, closedEras int
		if err := db.QueryRow(context.Background(), `SELECT count(*) FROM pair_membership AS membership
			JOIN participant ON participant.id=membership.participant_id
			JOIN pair ON pair.id=membership.pair_id
			WHERE membership.pair_id=$1 AND membership.ended_at=pair.terminated_at
			  AND membership.ended_display_name=participant.display_name
			  AND ((membership.slot='first' AND membership.ended_display_name='First')
			    OR (membership.slot='second' AND membership.ended_display_name='Second'))`, f.pairID).Scan(&frozenMemberships); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), `SELECT count(*) FROM pair_membership_era AS era
			JOIN pair ON pair.id=era.pair_id WHERE era.pair_id=$1 AND era.ended_at=pair.terminated_at`, f.pairID).Scan(&closedEras); err != nil {
			return err
		}
		if frozenMemberships != 2 || closedEras != 1 {
			return fmt.Errorf("termination froze %d memberships and closed %d eras", frozenMemberships, closedEras)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.StartOrResume(context.Background(), domain.StartInput{
		ParticipantID: f.firstID, PairID: f.pairID, Category: "memories",
	}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("post-termination Private start error=%v, want not found", err)
	}
	if _, err := f.service.Ask(context.Background(), domain.AskInput{
		ParticipantID: f.secondID, PairID: f.pairID,
		ConversationID: unresolvedForSecond.ConversationID, CandidateID: unresolvedForSecond.Candidate.ID,
	}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("post-termination Ask error=%v, want not found", err)
	}

	firstHistory, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.firstID, PairID: f.pairID, Limit: 20})
	if err != nil {
		t.Fatalf("former first-member history: %v", err)
	}
	secondHistory, err := f.service.History(context.Background(), domain.HistoryInput{ParticipantID: f.secondID, PairID: f.pairID, Limit: 20})
	if err != nil {
		t.Fatalf("former second-member history: %v", err)
	}
	findRound := func(page domain.HistoryPage) *domain.HistoryRound {
		for index := range page.Rounds {
			if page.Rounds[index].ID == round.ID {
				return &page.Rounds[index]
			}
		}
		return nil
	}
	firstRound, secondRound := findRound(firstHistory), findRound(secondHistory)
	for _, historyRound := range []*domain.HistoryRound{firstRound, secondRound} {
		if historyRound == nil || len(historyRound.Answers) != 2 || len(historyRound.Reactions) != 1 || len(historyRound.Replies) != 1 {
			t.Fatalf("former member's completed history = %+v", historyRound)
		}
		answersByName := map[string]string{}
		for _, answer := range historyRound.Answers {
			answersByName[answer.DisplayName] = answer.Body
		}
		if answersByName["First"] != "First member's completed answer" || answersByName["Second"] != "Second member's completed answer" {
			t.Fatalf("completed answer history = %+v", historyRound.Answers)
		}
		if historyRound.Reactions[0].DisplayName != "Second" || historyRound.Reactions[0].Value != "heart" || historyRound.Replies[0].DisplayName != "Second" || historyRound.Replies[0].Body != "Completed history reply" {
			t.Fatalf("completed interaction history = %+v", historyRound)
		}
	}
}

func TestConcurrentPairTerminationCommandsAreIdempotent(t *testing.T) {
	f := openFixture(t)
	databaseURL, err := testdb.LoadURL()
	if err != nil {
		t.Fatal(err)
	}
	listener, err := pgx.Connect(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close(context.Background()) })
	if _, err := listener.Exec(context.Background(), "LISTEN "+postgres.RealtimeChannel); err != nil {
		t.Fatal(err)
	}
	service := domainpair.NewService(postgrespair.NewStore(f.pool))
	start := make(chan struct{})
	type result struct {
		termination domainpair.Termination
		err         error
	}
	results := make(chan result, 2)
	var wait sync.WaitGroup
	for _, participantID := range []string{f.firstID, f.secondID} {
		wait.Add(1)
		go func(participantID string) {
			defer wait.Done()
			<-start
			termination, err := service.Terminate(context.Background(), participantID, f.pairID)
			results <- result{termination: termination, err: err}
		}(participantID)
	}
	close(start)
	wait.Wait()
	close(results)
	var first *domainpair.Termination
	changed := 0
	for outcome := range results {
		if outcome.err != nil {
			t.Fatalf("concurrent termination: %v", outcome.err)
		}
		if outcome.termination.Changed {
			changed++
		}
		if first == nil {
			copy := outcome.termination
			first = &copy
		} else if !first.TerminatedAt.Equal(outcome.termination.TerminatedAt) {
			t.Fatalf("concurrent commands returned different terminal timestamps: %v vs %v", first.TerminatedAt, outcome.termination.TerminatedAt)
		}
	}
	if changed != 1 || first == nil || first.State != "terminated" {
		t.Fatalf("termination winners=%d projection=%+v", changed, first)
	}
	notificationCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	notification, err := listener.WaitForNotification(notificationCtx)
	cancel()
	if err != nil {
		t.Fatalf("wait for pair.terminated notification: %v", err)
	}
	event, err := realtime.Decode([]byte(notification.Payload))
	if err != nil || event.PairID != f.pairID || event.Type != realtime.PairTerminated {
		t.Fatalf("termination notification = %+v, decode error=%v", event, err)
	}
	var committed bool
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT terminated_at IS NOT NULL FROM pair WHERE id=$1", f.pairID).Scan(&committed)
	}); err != nil {
		t.Fatal(err)
	}
	if !committed {
		t.Fatal("termination notification arrived before its Pair state committed")
	}
	noDuplicateCtx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if notification, err := listener.WaitForNotification(noDuplicateCtx); err == nil {
		event, decodeErr := realtime.Decode([]byte(notification.Payload))
		if decodeErr == nil && event.PairID == f.pairID && event.Type == realtime.PairTerminated {
			t.Fatal("idempotent termination published a duplicate pair.terminated event")
		}
	} else if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting for duplicate termination notification: %v", err)
	}
}

func TestTerminationSerializesWithPrivateCandidateAndAsk(t *testing.T) {
	t.Run("candidate creation", func(t *testing.T) {
		f := openFixture(t)
		createActiveQuestion(t, f, "deep", "Candidate versus termination")
		var created domain.View
		err := racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
			var err error
			created, err = f.service.StartOrResume(context.Background(), domain.StartInput{
				ParticipantID: f.firstID, PairID: f.pairID, Category: "deep",
			})
			return err
		})
		if err == nil && created.Candidate == nil {
			t.Fatalf("committed candidate creation returned no candidate: %+v", created)
		}
		var unresolved int
		if dbErr := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			return db.QueryRow(context.Background(), `SELECT count(*) FROM private_question_candidate candidate
				JOIN private_conversation conversation ON conversation.id=candidate.conversation_id
				WHERE conversation.pair_id=$1 AND candidate.state='unresolved'`, f.pairID).Scan(&unresolved)
		}); dbErr != nil {
			t.Fatal(dbErr)
		}
		if unresolved != 0 {
			t.Fatalf("termination left %d unresolved candidates", unresolved)
		}
	})

	t.Run("Ask", func(t *testing.T) {
		f := openFixture(t)
		view, err := f.service.StartOrResume(context.Background(), domain.StartInput{
			ParticipantID: f.firstID, PairID: f.pairID, Category: "fun",
		})
		if err != nil || view.Candidate == nil {
			t.Fatalf("start conversation: %+v %v", view, err)
		}
		var round domain.Round
		err = racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
			var askErr error
			round, askErr = f.service.Ask(context.Background(), domain.AskInput{
				ParticipantID: f.firstID, PairID: f.pairID,
				ConversationID: view.ConversationID, CandidateID: view.Candidate.ID,
			})
			return askErr
		})
		if err == nil && round.ID == "" {
			t.Fatal("Ask committed without a Round ID")
		}
	})
}

func TestTerminationSerializesWithPrivateAnswerRevealReactionReplyAndAskAnother(t *testing.T) {
	t.Run("answer", func(t *testing.T) {
		f := openFixture(t)
		view, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
		if err != nil || view.Candidate == nil {
			t.Fatalf("start: %+v %v", view, err)
		}
		round, err := f.service.Ask(context.Background(), domain.AskInput{ParticipantID: f.firstID, PairID: f.pairID, ConversationID: view.ConversationID, CandidateID: view.Candidate.ID})
		if err != nil {
			t.Fatal(err)
		}
		answerInput := domain.AnswerInput{RoundInput: domain.RoundInput{ParticipantID: f.secondID, PairID: f.pairID, RoundID: round.ID}, Body: "race answer"}
		_ = racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
			_, mutateErr := f.service.Answer(context.Background(), answerInput)
			return mutateErr
		})
	})

	t.Run("reveal", func(t *testing.T) {
		f := openFixture(t)
		_, a, _ := createMutuallyAnsweredRound(t, f)
		_ = racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
			_, mutateErr := f.service.Reveal(context.Background(), a)
			return mutateErr
		})
	})

	for _, command := range []string{"reaction", "reply"} {
		t.Run(command, func(t *testing.T) {
			f := openFixture(t)
			_, a, _ := createMutuallyRevealedRound(t, f)
			_ = racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
				if command == "reaction" {
					_, err := f.service.SetReaction(context.Background(), domain.ReactionInput{RoundInput: a, Value: "heart"})
					return err
				}
				_, err := f.service.SetReply(context.Background(), domain.ReplyInput{RoundInput: a, Body: "race reply"})
				return err
			})
		})
	}

	t.Run("Ask another", func(t *testing.T) {
		f := openFixture(t)
		createActiveQuestion(t, f, "fun", "Next candidate after completed Round")
		_, a, _ := createMutuallyRevealedRound(t, f)
		_ = racePairMutationWithTermination(t, f, f.firstID, domain.ErrNotFound, func() error {
			_, err := f.service.Progress(context.Background(), domain.ProgressInput{
				RoundInput: a, ClientRequestID: testUUID(t, f.pool), Action: "ask_another", Category: "fun",
			})
			return err
		})
	})
}

func createMutuallyAnsweredRound(t *testing.T, f fixture) (domain.Round, domain.RoundInput, domain.RoundInput) {
	t.Helper()
	started, err := f.service.StartOrResume(context.Background(), domain.StartInput{ParticipantID: f.firstID, PairID: f.pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start: %+v %v", started, err)
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
	return round, a, b
}

func TestTerminationSerializesWithTogetherStartAndAdvance(t *testing.T) {
	t.Run("Start", func(t *testing.T) {
		f := openFixture(t)
		createActiveTogetherQuestion(t, f, "Together start race first")
		service := domaintogether.NewService(postgrestogether.NewStore(f.pool))
		var started domaintogether.StartResult
		err := racePairMutationWithTermination(t, f, f.firstID, domaintogether.ErrPairNotFound, func() error {
			var mutateErr error
			started, mutateErr = service.Start(context.Background(), domaintogether.StartInput{
				ParticipantID: f.firstID, PairID: f.pairID, Category: "fun",
				ClientRequestID: testUUID(t, f.pool), SelectionSeed: "termination-start-race",
			})
			return mutateErr
		})
		if err == nil && started.SessionID == "" {
			t.Fatal("Together Start committed without a Session ID")
		}
	})

	t.Run("Advance", func(t *testing.T) {
		f := openFixture(t)
		createActiveTogetherQuestion(t, f, "Together advance race first")
		createActiveTogetherQuestion(t, f, "Together advance race second")
		service := domaintogether.NewService(postgrestogether.NewStore(f.pool))
		started, err := service.Start(context.Background(), domaintogether.StartInput{
			ParticipantID: f.firstID, PairID: f.pairID, Category: "fun", SelectionSeed: "termination-advance-race",
		})
		if err != nil {
			t.Fatalf("start Together before race: %v", err)
		}
		_ = racePairMutationWithTermination(t, f, f.firstID, domaintogether.ErrPairNotFound, func() error {
			_, err := service.Advance(context.Background(), domaintogether.AdvanceInput{
				PlaybackInput: domaintogether.PlaybackInput{ParticipantID: f.firstID, PairID: f.pairID, SessionID: started.SessionID},
				Action:        "next", ClientRequestID: testUUID(t, f.pool), CurrentQuestionID: started.QuestionID,
			})
			return err
		})
		playbackInput := domaintogether.PlaybackInput{ParticipantID: f.firstID, PairID: f.pairID, SessionID: started.SessionID}
		if _, err := service.Start(context.Background(), domaintogether.StartInput{
			ParticipantID: f.firstID, PairID: f.pairID, Category: "fun",
			ClientRequestID: testUUID(t, f.pool), SelectionSeed: "start-after-termination",
		}); !errors.Is(err, domaintogether.ErrPairNotFound) {
			t.Fatalf("Together Start after termination error=%v, want Pair not found", err)
		}
		if _, err := service.Like(context.Background(), domaintogether.LikeInput{
			PlaybackInput: playbackInput, Liked: true, CurrentQuestionID: started.QuestionID,
		}); !errors.Is(err, domaintogether.ErrPairNotFound) {
			t.Fatalf("Together Like after termination error=%v, want Pair not found", err)
		}
		for _, action := range []string{"next", "skip"} {
			if _, err := service.Advance(context.Background(), domaintogether.AdvanceInput{
				PlaybackInput: playbackInput, Action: action, ClientRequestID: testUUID(t, f.pool), CurrentQuestionID: started.QuestionID,
			}); !errors.Is(err, domaintogether.ErrPairNotFound) {
				t.Fatalf("Together %s after termination error=%v, want Pair not found", action, err)
			}
		}
		var retainedOccurrences int
		if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			return db.QueryRow(context.Background(), `SELECT count(*) FROM together_session_question
				WHERE session_id=$1 AND question_id=$2`, started.SessionID, started.QuestionID).Scan(&retainedOccurrences)
		}); err != nil {
			t.Fatal(err)
		}
		if retainedOccurrences != 1 {
			t.Fatalf("termination retained %d initial Together occurrences, want 1", retainedOccurrences)
		}
	})
}

func TestTerminationSerializesWithInitialInviteRedemption(t *testing.T) {
	f := openFixture(t)
	pairService := domainpair.NewService(postgrespair.NewStore(f.pool))
	created, err := pairService.Create(context.Background(), domainpair.CreateInput{
		ParticipantID: f.firstID, IntendedPersonName: "Claim race", RelationshipType: "partner", ClientRequestID: testUUID(t, f.pool),
	})
	if err != nil {
		t.Fatalf("create unclaimed Pair: %v", err)
	}
	claimantID := createReplacementParticipant(t, f)
	var claimantAuthID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT auth_user_id::text FROM participant WHERE id=$1", claimantID).Scan(&claimantAuthID)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id=$1", created.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id=$1", claimantID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id=$1", claimantAuthID)
			return nil
		})
	})
	inviteService := domaininvite.NewService(postgresinvite.NewStore(f.pool))
	issued, err := inviteService.Issue(context.Background(), f.firstID, created.ID)
	if err != nil {
		t.Fatalf("issue initial invite: %v", err)
	}
	racedFixture := f
	racedFixture.pairID = created.ID
	_ = racePairMutationWithTermination(t, racedFixture, f.firstID, domaininvite.ErrUnavailable, func() error {
		_, err := inviteService.Claim(context.Background(), issued.Token, claimantID)
		return err
	})
}
