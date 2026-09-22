package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

func TestRejoinRebindsExistingParticipantAndPreservesMembershipEra(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Creator")
	guest := createOnboardedTestActor(t, router, "Guest")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Guest")
	claim := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie)
	if claim.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", claim.Code, claim.Body.String())
	}

	beforeMe := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, guest.cookie)
	var oldActor meResponse
	if beforeMe.Code != http.StatusOK || json.Unmarshal(beforeMe.Body.Bytes(), &oldActor) != nil || oldActor.Actor == nil || oldActor.Actor.Participant == nil {
		t.Fatalf("old actor projection status=%d body=%s", beforeMe.Code, beforeMe.Body.String())
	}
	oldAuthUserID := oldActor.Actor.AuthUserID
	participantID := guest.participantID
	membershipID := currentMembershipID(t, pool, pairID, participantID)
	eraID := currentEraID(t, pool, pairID)
	participantsBefore := countAll(t, pool, "participant")
	membershipsBefore := countForPair(t, pool, "pair_membership", pairID)
	erasBefore := countForPair(t, pool, "pair_membership_era", pairID)

	if err := authService.RevokeSession(context.Background(), guest.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	if issued.Code != http.StatusCreated {
		t.Fatalf("issue rejoin status=%d body=%s", issued.Code, issued.Body.String())
	}
	var credential rejoinIssueResponse
	if err := json.Unmarshal(issued.Body.Bytes(), &credential); err != nil || credential.Token == "" {
		t.Fatalf("issue rejoin body=%s err=%v", issued.Body.String(), err)
	}

	freshAuth := createAnonymousTestCookie(t, router)
	redeem := performDomainRequest(router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{"displayName": "Ignored recovery label"}, freshAuth)
	if redeem.Code != http.StatusOK {
		t.Fatalf("redeem rejoin status=%d body=%s", redeem.Code, redeem.Body.String())
	}
	var result rejoinResponse
	if err := json.Unmarshal(redeem.Body.Bytes(), &result); err != nil || result.PairID != pairID || result.ParticipantID != participantID || result.MembershipEraID != eraID {
		t.Fatalf("rejoin response=%s err=%v", redeem.Body.String(), err)
	}

	afterMe := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, freshAuth)
	var newActor meResponse
	if afterMe.Code != http.StatusOK || json.Unmarshal(afterMe.Body.Bytes(), &newActor) != nil || newActor.Actor == nil || newActor.Actor.Participant == nil {
		t.Fatalf("new actor projection status=%d body=%s", afterMe.Code, afterMe.Body.String())
	}
	if newActor.Actor.AuthUserID == oldAuthUserID || newActor.Actor.Participant.ParticipantID != participantID {
		t.Fatalf("rejoin did not rebind the existing participant: old=%s new=%s participant=%s", oldAuthUserID, newActor.Actor.AuthUserID, newActor.Actor.Participant.ParticipantID)
	}
	if currentMembershipID(t, pool, pairID, participantID) != membershipID || currentEraID(t, pool, pairID) != eraID {
		t.Fatal("rejoin changed membership or era identity")
	}
	if countAll(t, pool, "participant") != participantsBefore || countForPair(t, pool, "pair_membership", pairID) != membershipsBefore || countForPair(t, pool, "pair_membership_era", pairID) != erasBefore {
		t.Fatal("rejoin created a participant, membership, or era")
	}
	if _, err := authService.ResolveSession(context.Background(), guest.cookie.Value); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("old auth session still resolves after rejoin: %v", err)
	}
	spaces := performDomainRequest(router, http.MethodGet, "/api/v1/pairs", nil, freshAuth)
	if spaces.Code != http.StatusOK {
		t.Fatalf("new auth could not act as current member: status=%d body=%s", spaces.Code, spaces.Body.String())
	}

	outsider := createOnboardedTestActor(t, router, "Outsider")
	oldInvite := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, outsider.cookie)
	if oldInvite.Code != http.StatusConflict {
		t.Fatalf("redeemed initial invite after lost session status=%d body=%s", oldInvite.Code, oldInvite.Body.String())
	}
}

func TestRejoinRejectsRedeemerThatAlreadyOwnsParticipant(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Creator")
	guest := createOnboardedTestActor(t, router, "Guest")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Guest")
	if response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie); response.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", response.Code, response.Body.String())
	}
	if err := authService.RevokeSession(context.Background(), guest.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	var credential rejoinIssueResponse
	if issued.Code != http.StatusCreated || json.Unmarshal(issued.Body.Bytes(), &credential) != nil {
		t.Fatalf("issue rejoin status=%d body=%s", issued.Code, issued.Body.String())
	}

	outsider := createOnboardedTestActor(t, router, "Already owned")
	participantsBefore := countAll(t, pool, "participant")
	membershipsBefore := countForPair(t, pool, "pair_membership", pairID)
	erasBefore := countForPair(t, pool, "pair_membership_era", pairID)
	redeem := performDomainRequest(router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{"displayName": "Must not merge"}, outsider.cookie)
	if redeem.Code != http.StatusConflict {
		t.Fatalf("redeem with existing participant status=%d body=%s", redeem.Code, redeem.Body.String())
	}
	if countAll(t, pool, "participant") != participantsBefore || countForPair(t, pool, "pair_membership", pairID) != membershipsBefore || countForPair(t, pool, "pair_membership_era", pairID) != erasBefore {
		t.Fatal("existing-participant redeemer changed Pair state")
	}
	me := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, outsider.cookie)
	var outsiderActor meResponse
	if me.Code != http.StatusOK || json.Unmarshal(me.Body.Bytes(), &outsiderActor) != nil || outsiderActor.Actor == nil || outsiderActor.Actor.Participant == nil || outsiderActor.Actor.Participant.ParticipantID != outsider.participantID {
		t.Fatalf("existing redeemer was merged: status=%d body=%s", me.Code, me.Body.String())
	}
}

func TestRejoinRejectsRegisteredTarget(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Creator")
	guest := createOnboardedTestActor(t, router, "Registered target")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Registered target")
	if response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie); response.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", response.Code, response.Body.String())
	}
	upgrade := performDomainRequest(router, http.MethodPost, "/api/v1/auth/upgrade", map[string]string{
		"email":    "registered-target-" + guest.participantID + "@example.test",
		"password": "Valid-passphrase-2040",
	}, guest.cookie)
	if upgrade.Code != http.StatusOK {
		t.Fatalf("upgrade target status=%d body=%s", upgrade.Code, upgrade.Body.String())
	}
	if err := authService.RevokeSession(context.Background(), guest.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	if issued.Code != http.StatusConflict {
		t.Fatalf("registered target was eligible for rejoin status=%d body=%s", issued.Code, issued.Body.String())
	}
}

func TestRejoinCredentialIsSingleUseUnderConcurrentRedemption(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Concurrent creator")
	guest := createOnboardedTestActor(t, router, "Concurrent guest")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Concurrent guest")
	if response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie); response.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", response.Code, response.Body.String())
	}
	if err := authService.RevokeSession(context.Background(), guest.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	var credential rejoinIssueResponse
	if issued.Code != http.StatusCreated || json.Unmarshal(issued.Body.Bytes(), &credential) != nil {
		t.Fatalf("issue rejoin status=%d body=%s", issued.Code, issued.Body.String())
	}
	a := createAnonymousTestCookie(t, router)
	b := createAnonymousTestCookie(t, router)
	responses := make(chan int, 2)
	var wait sync.WaitGroup
	for _, cookie := range []*http.Cookie{a, b} {
		wait.Add(1)
		go func(cookie *http.Cookie) {
			defer wait.Done()
			responses <- performDomainRequest(router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{"displayName": "One winner"}, cookie).Code
		}(cookie)
	}
	wait.Wait()
	close(responses)
	wins, conflicts := 0, 0
	for status := range responses {
		switch status {
		case http.StatusOK:
			wins++
		case http.StatusConflict:
			conflicts++
		default:
			t.Fatalf("unexpected concurrent rejoin status=%d", status)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("rejoin race wins/conflicts=%d/%d", wins, conflicts)
	}
	if countForPair(t, pool, "pair_membership", pairID) != 2 || countForPair(t, pool, "pair_membership_era", pairID) != 1 {
		t.Fatal("rejoin race produced duplicate membership or era")
	}
}

func TestRejoinFailsAfterTargetMembershipEnds(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Creator")
	guest := createOnboardedTestActor(t, router, "Guest")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Guest")
	if response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie); response.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", response.Code, response.Body.String())
	}
	if err := authService.RevokeSession(context.Background(), guest.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	var credential rejoinIssueResponse
	if issued.Code != http.StatusCreated || json.Unmarshal(issued.Body.Bytes(), &credential) != nil {
		t.Fatalf("issue rejoin status=%d body=%s", issued.Code, issued.Body.String())
	}
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, err := db.Exec(context.Background(), `UPDATE pair_membership SET ended_at = clock_timestamp(), ended_display_name = 'Guest' WHERE pair_id = $1 AND participant_id = $2`, pairID, guest.participantID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	freshAuth := createAnonymousTestCookie(t, router)
	redeem := performDomainRequest(router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{"displayName": "No replacement"}, freshAuth)
	if redeem.Code != http.StatusConflict {
		t.Fatalf("rejoin against ended membership status=%d body=%s", redeem.Code, redeem.Body.String())
	}
	if countForPair(t, pool, "pair_membership", pairID) != 2 || countForPair(t, pool, "pair_membership_era", pairID) != 1 {
		t.Fatal("failed rejoin changed membership or era counts")
	}
}

func TestRejoinIssueIsSymmetricAndRequiresLostTargetSession(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	first := createOnboardedTestActor(t, router, "First")
	second := createOnboardedTestActor(t, router, "Second")
	pairID, initialToken := issueInviteForTest(t, router, first, "Second")
	if response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, second.cookie); response.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", response.Code, response.Body.String())
	}
	activeTarget := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, first.cookie)
	if activeTarget.Code != http.StatusConflict {
		t.Fatalf("active target rejoin status=%d body=%s", activeTarget.Code, activeTarget.Body.String())
	}
	if err := authService.RevokeSession(context.Background(), first.cookie.Value); err != nil {
		t.Fatal(err)
	}
	issued := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, second.cookie)
	if issued.Code != http.StatusCreated {
		t.Fatalf("symmetric issue status=%d body=%s", issued.Code, issued.Body.String())
	}
	var credential rejoinIssueResponse
	if err := json.Unmarshal(issued.Body.Bytes(), &credential); err != nil || credential.Token == "" {
		t.Fatal(err)
	}
	if credential.TargetParticipantDisplayName != "First" {
		t.Fatalf("target display name=%q", credential.TargetParticipantDisplayName)
	}
}

func countAll(t *testing.T, pool *postgres.Pool, table string) int {
	t.Helper()
	var count int
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&count)
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func currentMembershipID(t *testing.T, pool *postgres.Pool, pairID, participantID string) string {
	t.Helper()
	var id string
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), `SELECT id FROM pair_membership WHERE pair_id = $1 AND participant_id = $2 AND ended_at IS NULL`, pairID, participantID).Scan(&id)
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func currentEraID(t *testing.T, pool *postgres.Pool, pairID string) string {
	t.Helper()
	var id string
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), `SELECT id FROM pair_membership_era WHERE pair_id = $1 AND ended_at IS NULL`, pairID).Scan(&id)
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}
