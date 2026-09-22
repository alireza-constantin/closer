package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

func TestRejoinReplacementCreatesNewEraAndFreezesFormerMembership(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, authService := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Creator")
	guest := createOnboardedTestActor(t, router, "Former guest")
	pairID, initialToken := issueInviteForTest(t, router, creator, "Guest")
	claim := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, guest.cookie)
	if claim.Code != http.StatusOK {
		t.Fatalf("claim status=%d body=%s", claim.Code, claim.Body.String())
	}
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
	landing := performDomainRequest(router, http.MethodGet, "/api/v1/rejoin/"+credential.Token, nil, nil)
	if landing.Code != http.StatusOK {
		t.Fatalf("rejoin landing status=%d body=%s", landing.Code, landing.Body.String())
	}

	replacement := createAnonymousTestCookie(t, router)
	redeem := performDomainRequest(router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{"displayName": "Replacement"}, replacement)
	if redeem.Code != http.StatusOK {
		t.Fatalf("redeem rejoin status=%d body=%s", redeem.Code, redeem.Body.String())
	}
	var result rejoinResponse
	if err := json.Unmarshal(redeem.Body.Bytes(), &result); err != nil || result.PairID != pairID {
		t.Fatalf("redeem response=%s err=%v", redeem.Body.String(), err)
	}
	if countForPair(t, pool, "pair_membership", pairID) != 3 || countForPair(t, pool, "pair_membership_era", pairID) != 2 {
		t.Fatal("replacement did not preserve one historical membership and create one new era")
	}

	var endedName string
	var endedCount, openEraCount, openSecondCount int
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), `SELECT ended_display_name FROM pair_membership WHERE pair_id = $1 AND participant_id = $2`, pairID, guest.participantID).Scan(&endedName); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), `SELECT count(*) FROM pair_membership WHERE pair_id = $1 AND ended_at IS NULL AND slot = 'second'`, pairID).Scan(&openSecondCount); err != nil {
			return err
		}
		if err := db.QueryRow(context.Background(), `SELECT count(*) FROM pair_membership_era WHERE pair_id = $1 AND ended_at IS NULL`, pairID).Scan(&openEraCount); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), `SELECT count(*) FROM pair_membership WHERE pair_id = $1 AND ended_at IS NOT NULL`, pairID).Scan(&endedCount)
	})
	if err != nil {
		t.Fatal(err)
	}
	if endedName != "Former guest" || endedCount != 1 || openEraCount != 1 || openSecondCount != 1 {
		t.Fatalf("replacement state endedName=%q ended=%d openEras=%d openSecond=%d", endedName, endedCount, openEraCount, openSecondCount)
	}

	outsider := createOnboardedTestActor(t, router, "Outsider")
	oldInvite := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+initialToken+"/redeem", nil, outsider.cookie)
	if oldInvite.Code != http.StatusConflict {
		t.Fatalf("redeemed initial invite after lost session status=%d body=%s", oldInvite.Code, oldInvite.Body.String())
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
	if countForPair(t, pool, "pair_membership", pairID) != 3 || countForPair(t, pool, "pair_membership_era", pairID) != 2 {
		t.Fatal("rejoin race produced duplicate current membership or era")
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
