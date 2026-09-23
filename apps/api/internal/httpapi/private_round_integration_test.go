package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
	postgresparticipant "github.com/alireza-constantin/closer/apps/api/internal/postgres/participant"
	postgresprivate "github.com/alireza-constantin/closer/apps/api/internal/postgres/private"
	postgresquestion "github.com/alireza-constantin/closer/apps/api/internal/postgres/question"
	privatedomain "github.com/alireza-constantin/closer/apps/api/internal/private"
	"github.com/alireza-constantin/closer/apps/api/internal/question"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

func TestPrivateRoundHTTPJSONKeepsAnswersPrivateUntilEachReveal(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	ctx := context.Background()
	authStore := postgresauth.NewStore(pool)
	authService := auth.NewServiceWithCredentials(authStore, authStore, nil)
	participantService := participant.NewService(postgresparticipant.NewStore(pool))
	privateStore := postgresprivate.NewStore(pool)
	privateService := privatedomain.NewService(privateStore)
	questionService := question.NewService(postgresquestion.NewStore(pool, privateStore))
	router := NewRouterWithQuestionPrivateRealtime(
		nil,
		nil,
		authService,
		participantService,
		nil,
		nil,
		questionService,
		privateService,
		realtime.NewRegistry(16),
		SecurityConfig{TrustedOrigins: []string{domainTestOrigin}},
	)

	firstAuth, err := authService.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	secondAuth, err := authService.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	outsiderAuth, err := authService.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	replacementAuth, err := authService.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first, err := participantService.Onboard(ctx, firstAuth.Actor, "First")
	if err != nil {
		t.Fatal(err)
	}
	second, err := participantService.Onboard(ctx, secondAuth.Actor, "Second")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := participantService.Onboard(ctx, outsiderAuth.Actor, "Outsider")
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := participantService.Onboard(ctx, replacementAuth.Actor, "Replacement")
	if err != nil {
		t.Fatal(err)
	}

	adminAuthID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := authStore.BootstrapAdmin(ctx, adminAuthID, fmt.Sprintf("p03-%s@example.test", adminAuthID), "test-only-password-hash", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	createdQuestion, err := questionService.Create(ctx, question.RevisionFields{
		Text:            "HTTP secrecy question",
		Category:        "fun",
		RelationshipFit: "both",
		ModeFit:         "private",
		Intensity:       "light",
	}, adminAuthID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := questionService.SetActivity(ctx, createdQuestion.ID, "activate", adminAuthID); err != nil {
		t.Fatal(err)
	}

	var pairID string
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		if err := db.QueryRow(ctx, "INSERT INTO pair(relationship_type) VALUES ('partner') RETURNING id::text").Scan(&pairID); err != nil {
			return err
		}
		var firstMembership, secondMembership string
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'first') RETURNING id::text", pairID, first.ID).Scan(&firstMembership); err != nil {
			return err
		}
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", pairID, second.ID).Scan(&secondMembership); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3)", pairID, firstMembership, secondMembership)
		return err
	}); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		_ = pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
			_, _ = db.Exec(context.Background(), "DELETE FROM pair WHERE id = $1", pairID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_lifecycle_event WHERE question_id = $1", createdQuestion.ID)
			_, _ = db.Exec(context.Background(), "UPDATE question SET current_revision_id = NULL WHERE id = $1", createdQuestion.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question_revision WHERE question_id = $1", createdQuestion.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM question WHERE id = $1", createdQuestion.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM admin_user WHERE auth_user_id = $1", adminAuthID)
			_, _ = db.Exec(context.Background(), "DELETE FROM participant WHERE id IN ($1, $2, $3, $4)", first.ID, second.ID, outsider.ID, replacement.ID)
			_, _ = db.Exec(context.Background(), "DELETE FROM auth_user WHERE id IN ($1, $2, $3, $4, $5)", firstAuth.Actor.AuthUserID, secondAuth.Actor.AuthUserID, outsiderAuth.Actor.AuthUserID, replacementAuth.Actor.AuthUserID, adminAuthID)
			return nil
		})
	})

	started, err := privateService.StartOrResume(ctx, privatedomain.StartInput{ParticipantID: first.ID, PairID: pairID, Category: "fun"})
	if err != nil || started.Candidate == nil {
		t.Fatalf("start = %+v, err=%v", started, err)
	}
	unresolvedHistory := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, &http.Cookie{Name: auth.SessionCookieName, Value: secondAuth.Token})
	if unresolvedHistory.Code != http.StatusOK || strings.Contains(unresolvedHistory.Body.String(), "HTTP secrecy question") || strings.Contains(unresolvedHistory.Body.String(), "candidate") {
		t.Fatalf("unresolved candidate leaked through history: status=%d body=%s", unresolvedHistory.Code, unresolvedHistory.Body.String())
	}
	round, err := privateService.Ask(ctx, privatedomain.AskInput{
		ParticipantID:  first.ID,
		PairID:         pairID,
		ConversationID: started.ConversationID,
		CandidateID:    started.Candidate.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	firstCookie := &http.Cookie{Name: auth.SessionCookieName, Value: firstAuth.Token}
	secondCookie := &http.Cookie{Name: auth.SessionCookieName, Value: secondAuth.Token}
	path := fmt.Sprintf("/api/v1/pairs/%s/private-rounds/%s", pairID, round.ID)

	firstAnswer := performDomainRequest(router, http.MethodPost, path+"/answer", map[string]string{"body": "FIRST-HTTP-SENTINEL"}, firstCookie)
	if firstAnswer.Code != http.StatusOK || !strings.Contains(firstAnswer.Body.String(), "FIRST-HTTP-SENTINEL") || strings.Contains(firstAnswer.Body.String(), "SECOND-HTTP-SENTINEL") {
		t.Fatalf("first answer response leaked or failed: status=%d body=%s", firstAnswer.Code, firstAnswer.Body.String())
	}
	secondAnswer := performDomainRequest(router, http.MethodPost, path+"/answer", map[string]string{"body": "SECOND-HTTP-SENTINEL"}, secondCookie)
	if secondAnswer.Code != http.StatusOK {
		t.Fatalf("second answer status=%d body=%s", secondAnswer.Code, secondAnswer.Body.String())
	}

	ready := performDomainRequest(router, http.MethodGet, path, nil, firstCookie)
	if ready.Code != http.StatusOK || strings.Contains(ready.Body.String(), "SECOND-HTTP-SENTINEL") {
		t.Fatalf("ready response leaked answer: status=%d body=%s", ready.Code, ready.Body.String())
	}
	var readyProjection privateRoundProjection
	if err := json.Unmarshal(ready.Body.Bytes(), &readyProjection); err != nil {
		t.Fatal(err)
	}
	if readyProjection.State != "REVEAL_READY" || len(readyProjection.Answers) != 0 {
		t.Fatalf("ready projection = %+v", readyProjection)
	}

	firstReveal := performDomainRequest(router, http.MethodPost, path+"/reveal", nil, firstCookie)
	if firstReveal.Code != http.StatusOK || !strings.Contains(firstReveal.Body.String(), "FIRST-HTTP-SENTINEL") || !strings.Contains(firstReveal.Body.String(), "SECOND-HTTP-SENTINEL") {
		t.Fatalf("first reveal did not expose both answers to the revealer: status=%d body=%s", firstReveal.Code, firstReveal.Body.String())
	}
	secondBeforeReveal := performDomainRequest(router, http.MethodGet, path, nil, secondCookie)
	if secondBeforeReveal.Code != http.StatusOK || strings.Contains(secondBeforeReveal.Body.String(), "FIRST-HTTP-SENTINEL") {
		t.Fatalf("second participant saw answer before own reveal: status=%d body=%s", secondBeforeReveal.Code, secondBeforeReveal.Body.String())
	}
	secondReveal := performDomainRequest(router, http.MethodPost, path+"/reveal", nil, secondCookie)
	if secondReveal.Code != http.StatusOK || !strings.Contains(secondReveal.Body.String(), "FIRST-HTTP-SENTINEL") || !strings.Contains(secondReveal.Body.String(), "SECOND-HTTP-SENTINEL") {
		t.Fatalf("second reveal did not expose both answers: status=%d body=%s", secondReveal.Code, secondReveal.Body.String())
	}
	if response := performDomainRequest(router, http.MethodPut, path+"/reaction", map[string]string{"value": "heart"}, secondCookie); response.Code != http.StatusOK {
		t.Fatalf("historical reaction setup status=%d body=%s", response.Code, response.Body.String())
	}
	if response := performDomainRequest(router, http.MethodPut, path+"/reply", map[string]string{"body": "B_REPLY_ERA1"}, secondCookie); response.Code != http.StatusOK {
		t.Fatalf("historical reply setup status=%d body=%s", response.Code, response.Body.String())
	}
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		var eraID, firstMembershipID, secondMembershipID string
		if err := db.QueryRow(ctx, "SELECT id::text, first_membership_id::text, second_membership_id::text FROM pair_membership_era WHERE pair_id = $1 AND ended_at IS NULL", pairID).Scan(&eraID, &firstMembershipID, &secondMembershipID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership SET ended_at = now(), ended_display_name = 'Second' WHERE id = $1", secondMembershipID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE pair_membership_era SET ended_at = now() WHERE id = $1", eraID); err != nil {
			return err
		}
		var replacementMembershipID string
		if err := db.QueryRow(ctx, "INSERT INTO pair_membership(pair_id, participant_id, slot) VALUES ($1, $2, 'second') RETURNING id::text", pairID, replacement.ID).Scan(&replacementMembershipID); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "INSERT INTO pair_membership_era(pair_id, first_membership_id, second_membership_id) VALUES ($1, $2, $3)", pairID, firstMembershipID, replacementMembershipID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	history := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, firstCookie)
	if history.Code != http.StatusOK || !strings.Contains(history.Body.String(), "HTTP secrecy question") || !strings.Contains(history.Body.String(), "FIRST-HTTP-SENTINEL") || !strings.Contains(history.Body.String(), "SECOND-HTTP-SENTINEL") || !strings.Contains(history.Body.String(), "B_REPLY_ERA1") || !strings.Contains(history.Body.String(), "heart") || !strings.Contains(history.Body.String(), "Second") {
		t.Fatalf("revealed Round history was missing or incomplete: status=%d body=%s", history.Code, history.Body.String())
	}
	replacementCookie := &http.Cookie{Name: auth.SessionCookieName, Value: replacementAuth.Token}
	replacementHistory := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, replacementCookie)
	for _, secret := range []string{"HTTP secrecy question", "FIRST-HTTP-SENTINEL", "SECOND-HTTP-SENTINEL", "B_REPLY_ERA1", "heart"} {
		if replacementHistory.Code != http.StatusOK || strings.Contains(replacementHistory.Body.String(), secret) {
			t.Fatalf("replacement history leaked %q: status=%d body=%s", secret, replacementHistory.Code, replacementHistory.Body.String())
		}
	}
	formerHistory := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, secondCookie)
	if formerHistory.Code != http.StatusOK || !strings.Contains(formerHistory.Body.String(), "B_REPLY_ERA1") {
		t.Fatalf("former member read-only history status=%d body=%s", formerHistory.Code, formerHistory.Body.String())
	}
	if mutation := performDomainRequest(router, http.MethodPut, path+"/reply", map[string]string{"body": "former cannot edit"}, secondCookie); mutation.Code != http.StatusNotFound {
		t.Fatalf("former member mutation status=%d body=%s", mutation.Code, mutation.Body.String())
	}
	outsiderCookie := &http.Cookie{Name: auth.SessionCookieName, Value: outsiderAuth.Token}
	outsiderHistory := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, outsiderCookie)
	if outsiderHistory.Code != http.StatusNotFound || strings.Contains(outsiderHistory.Body.String(), "FIRST-HTTP-SENTINEL") || strings.Contains(outsiderHistory.Body.String(), "SECOND-HTTP-SENTINEL") {
		t.Fatalf("outsider history response status=%d body=%s", outsiderHistory.Code, outsiderHistory.Body.String())
	}
	unauthenticatedHistory := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history", pairID), nil, nil)
	if unauthenticatedHistory.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated history status=%d body=%s", unauthenticatedHistory.Code, unauthenticatedHistory.Body.String())
	}
	badCursor := performDomainRequest(router, http.MethodGet, fmt.Sprintf("/api/v1/pairs/%s/private-history?cursor=not-a-cursor", pairID), nil, firstCookie)
	if badCursor.Code != http.StatusBadRequest {
		t.Fatalf("malformed history cursor status=%d body=%s", badCursor.Code, badCursor.Body.String())
	}
}
