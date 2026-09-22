package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

func issueInviteForTest(t *testing.T, router http.Handler, creator testHTTPActor, intended string) (string, string) {
	t.Helper()
	pairResponse := performDomainRequest(router, http.MethodPost, "/api/v1/pairs", map[string]string{
		"intendedPersonName": intended, "relationshipType": "friend",
	}, creator.cookie)
	var created createPairResponse
	if pairResponse.Code != http.StatusOK || json.Unmarshal(pairResponse.Body.Bytes(), &created) != nil {
		t.Fatalf("create Pair: %d %s", pairResponse.Code, pairResponse.Body.String())
	}
	issuedResponse := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+created.PairID+"/invite", nil, creator.cookie)
	var issued inviteStateResponse
	if issuedResponse.Code != http.StatusCreated || json.Unmarshal(issuedResponse.Body.Bytes(), &issued) != nil || issued.Token == "" {
		t.Fatalf("issue invite: %d %s", issuedResponse.Code, issuedResponse.Body.String())
	}
	return created.PairID, issued.Token
}

func TestInitialClaimSameClaimantRetryRaceCreatesOneRedemption(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Retry creator")
	pairID, token := issueInviteForTest(t, router, creator, "Retry claimant")
	claimant := createOnboardedTestActor(t, router, "Retry claimant")

	responses := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			responses <- performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+token+"/redeem", nil, claimant.cookie).Code
		}()
	}
	wait.Wait()
	close(responses)
	successes, conflicts := 0, 0
	for status := range responses {
		switch status {
		case http.StatusOK:
			successes++
		case http.StatusConflict:
			conflicts++
		default:
			t.Fatalf("unexpected retry-race status %d", status)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("same-claimant race successes/conflicts=%d/%d", successes, conflicts)
	}
	if countForPair(t, pool, "pair_membership", pairID) != 2 || countForPair(t, pool, "pair_membership_era", pairID) != 1 {
		t.Fatal("same-claimant retry race produced duplicate membership or era")
	}
}

func TestInitialClaimVsRevokeSerializesWithoutPartialPairState(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Revoke creator")
	pairID, token := issueInviteForTest(t, router, creator, "Revoke claimant")
	claimant := createOnboardedTestActor(t, router, "Revoke claimant")

	claimResult := make(chan int, 1)
	revokeResult := make(chan int, 1)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		claimResult <- performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+token+"/redeem", nil, claimant.cookie).Code
	}()
	go func() {
		defer wait.Done()
		revokeResult <- performDomainRequest(router, http.MethodDelete, "/api/v1/pairs/"+pairID+"/invite", nil, creator.cookie).Code
	}()
	wait.Wait()
	claimStatus, revokeStatus := <-claimResult, <-revokeResult
	if revokeStatus != http.StatusNoContent {
		t.Fatalf("revoke-vs-claim status=%d, want 204", revokeStatus)
	}
	if claimStatus != http.StatusOK && claimStatus != http.StatusConflict {
		t.Fatalf("unexpected claim-vs-revoke status=%d", claimStatus)
	}
	if claimStatus == http.StatusOK {
		if countForPair(t, pool, "pair_membership", pairID) != 2 || countForPair(t, pool, "pair_membership_era", pairID) != 1 {
			t.Fatal("successful claim left partial Pair state")
		}
	} else if countForPair(t, pool, "pair_membership", pairID) != 1 || countForPair(t, pool, "pair_membership_era", pairID) != 0 {
		t.Fatal("revoked claim left partial Pair state")
	}
}

func TestInitialClaimRechecksExpiryInsideTransaction(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Expiry creator")
	pairID, token := issueInviteForTest(t, router, creator, "Expiry claimant")
	claimant := createOnboardedTestActor(t, router, "Expiry claimant")
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, err := db.Exec(context.Background(), "UPDATE initial_invite SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE pair_id=$1", pairID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	response := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+token+"/redeem", nil, claimant.cookie)
	if response.Code != http.StatusConflict {
		t.Fatalf("expired claim status=%d body=%s", response.Code, response.Body.String())
	}
	if countForPair(t, pool, "pair_membership", pairID) != 1 || countForPair(t, pool, "pair_membership_era", pairID) != 0 {
		t.Fatal("expired claim changed Pair state")
	}
}

func TestInitialClaimDuplicatePairRaceUsesUnorderedParticipantLock(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	first := createOnboardedTestActor(t, router, "Duplicate A")
	second := createOnboardedTestActor(t, router, "Duplicate B")
	firstPair, firstToken := issueInviteForTest(t, router, first, "Duplicate B")
	secondPair, secondToken := issueInviteForTest(t, router, second, "Duplicate A")

	responses := make(chan int, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		responses <- performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+firstToken+"/redeem", nil, second.cookie).Code
	}()
	go func() {
		defer wait.Done()
		responses <- performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+secondToken+"/redeem", nil, first.cookie).Code
	}()
	wait.Wait()
	close(responses)
	successes, conflicts := 0, 0
	for status := range responses {
		switch status {
		case http.StatusOK:
			successes++
		case http.StatusConflict:
			conflicts++
		default:
			t.Fatalf("unexpected duplicate-pair race status %d", status)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("duplicate-pair race successes/conflicts=%d/%d", successes, conflicts)
	}
	claimedPairs := 0
	for _, pairID := range []string{firstPair, secondPair} {
		if countForPair(t, pool, "pair_membership", pairID) == 2 {
			claimedPairs++
		}
	}
	if claimedPairs != 1 {
		t.Fatalf("duplicate-pair race left %d fully claimed Pairs, want 1", claimedPairs)
	}
}
