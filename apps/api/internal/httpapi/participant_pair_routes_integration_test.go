package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/invite"
	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
	postgresinvite "github.com/alireza-constantin/closer/apps/api/internal/postgres/invite"
	postgrespair "github.com/alireza-constantin/closer/apps/api/internal/postgres/pair"
	postgresparticipant "github.com/alireza-constantin/closer/apps/api/internal/postgres/participant"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/jackc/pgx/v5/pgtype"
)

const domainTestOrigin = "https://closer.example"

func openParticipantPairTestPool(t *testing.T) *postgres.Pool {
	t.Helper()
	if _, err := testdb.LoadURL(); err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to local closer_test with the Go schema")
		}
		t.Fatalf("load guarded closer_test URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded closer_test pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newParticipantPairRouter(pool *postgres.Pool) (http.Handler, *auth.Service) {
	authStore := postgresauth.NewStore(pool)
	participantService := participant.NewService(postgresparticipant.NewStore(pool))
	pairService := pair.NewService(postgrespair.NewStore(pool))
	inviteService := invite.NewService(postgresinvite.NewStore(pool))
	authService := auth.NewServiceWithCredentials(authStore, authStore, nil)
	return NewRouterWithServices(nil, pool, authService, participantService, pairService, inviteService, SecurityConfig{
		TrustedOrigins: []string{domainTestOrigin},
	}), authService
}

func performDomainRequest(router http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	var requestBody bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&requestBody).Encode(body)
	}
	request := httptest.NewRequest(method, path, &requestBody)
	if method != http.MethodGet {
		request.Header.Set("Origin", domainTestOrigin)
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func createAnonymousTestCookie(t *testing.T, router http.Handler) *http.Cookie {
	t.Helper()
	response := performDomainRequest(router, http.MethodPost, "/api/v1/auth/anonymous", nil, nil)
	if response.Code != http.StatusCreated {
		t.Fatalf("create anonymous identity status = %d, body = %s", response.Code, response.Body.String())
	}
	return onlySessionCookie(t, response)
}

func TestParticipantPairHTTPFlowAndAuthUpgradePreserveOwnership(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	ctx := context.Background()
	cookie := createAnonymousTestCookie(t, router)

	me := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, cookie)
	if me.Code != http.StatusOK || me.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("GET /me before onboarding status/cache = %d/%q, body=%s", me.Code, me.Header().Get("Cache-Control"), me.Body.String())
	}
	var initialMe meResponse
	if err := json.Unmarshal(me.Body.Bytes(), &initialMe); err != nil || initialMe.Actor == nil || initialMe.Actor.Participant != nil {
		t.Fatalf("pre-onboarding actor = %+v, error = %v", initialMe.Actor, err)
	}
	authUserID := initialMe.Actor.AuthUserID
	if count := participantCountForAuthUser(t, pool, authUserID); count != 0 {
		t.Fatalf("GET /me created %d Participants", count)
	}

	type onboardingResult struct {
		status int
		body   onboardingResponse
		raw    string
		err    error
	}
	const concurrentOnboardings = 8
	results := make(chan onboardingResult, concurrentOnboardings)
	var onboardingWait sync.WaitGroup
	for index := 0; index < concurrentOnboardings; index++ {
		onboardingWait.Add(1)
		go func(index int) {
			defer onboardingWait.Done()
			response := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{
				"displayName": "  Ari " + string(rune('A'+index)) + "  ",
			}, cookie)
			result := onboardingResult{status: response.Code, raw: response.Body.String()}
			result.err = json.Unmarshal(response.Body.Bytes(), &result.body)
			results <- result
		}(index)
	}
	onboardingWait.Wait()
	close(results)
	participantIDs := map[string]bool{}
	canonicalName := ""
	for result := range results {
		if result.status != http.StatusOK || result.err != nil {
			t.Fatalf("concurrent onboarding response status=%d body=%q err=%v", result.status, result.raw, result.err)
		}
		participantIDs[result.body.ParticipantID] = true
		if canonicalName == "" {
			canonicalName = result.body.DisplayName
		}
		if result.body.DisplayName != canonicalName {
			t.Fatalf("concurrent onboarding returned different canonical names: %q and %q", canonicalName, result.body.DisplayName)
		}
	}
	if len(participantIDs) != 1 || participantCountForAuthUser(t, pool, authUserID) != 1 {
		t.Fatalf("concurrent onboarding created Participant IDs=%v count=%d", participantIDs, participantCountForAuthUser(t, pool, authUserID))
	}
	var participantID string
	for id := range participantIDs {
		participantID = id
	}

	// A retry with a different name remains idempotent and does not rename the
	// existing Participant as an implicit side effect.
	retry := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{"displayName": "Changed"}, cookie)
	var retryBody onboardingResponse
	if retry.Code != http.StatusOK || json.Unmarshal(retry.Body.Bytes(), &retryBody) != nil || retryBody.ParticipantID != participantID || retryBody.DisplayName != canonicalName {
		t.Fatalf("onboarding retry response status=%d body=%s", retry.Code, retry.Body.String())
	}

	me = performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, cookie)
	var onboardedMe meResponse
	if me.Code != http.StatusOK || json.Unmarshal(me.Body.Bytes(), &onboardedMe) != nil || onboardedMe.Actor == nil || onboardedMe.Actor.Participant == nil || onboardedMe.Actor.Participant.ParticipantID != participantID {
		t.Fatalf("participant-aware /me projection = %s", me.Body.String())
	}

	createRequestID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	createBody := map[string]string{
		"intendedPersonName": "  Bea  ", "relationshipType": "partner", "clientRequestId": createRequestID,
	}
	const concurrentCreates = 6
	createdIDs := make(chan string, concurrentCreates)
	var createWait sync.WaitGroup
	for index := 0; index < concurrentCreates; index++ {
		createWait.Add(1)
		go func() {
			defer createWait.Done()
			response := performDomainRequest(router, http.MethodPost, "/api/v1/pairs", createBody, cookie)
			if response.Code != http.StatusOK {
				createdIDs <- "ERROR:" + response.Body.String()
				return
			}
			var created createPairResponse
			if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
				createdIDs <- "ERROR:" + err.Error()
				return
			}
			createdIDs <- created.PairID
		}()
	}
	createWait.Wait()
	close(createdIDs)
	pairIDs := map[string]bool{}
	for id := range createdIDs {
		if len(id) > 6 && id[:6] == "ERROR:" {
			t.Fatalf("concurrent Pair create failed: %s", id)
		}
		pairIDs[id] = true
	}
	if len(pairIDs) != 1 {
		t.Fatalf("same Pair create request produced IDs %v", pairIDs)
	}
	var pairID string
	for id := range pairIDs {
		pairID = id
	}

	// Different requests intentionally create another legitimate unclaimed
	// Pair; a Participant may belong to multiple active Pairs.
	friendRequestID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	friendResponse := performDomainRequest(router, http.MethodPost, "/api/v1/pairs", map[string]string{
		"intendedPersonName": "  Cam  ", "relationshipType": "friend", "clientRequestId": friendRequestID,
	}, cookie)
	var friendPair createPairResponse
	if friendResponse.Code != http.StatusOK || json.Unmarshal(friendResponse.Body.Bytes(), &friendPair) != nil || friendPair.PairID == pairID || friendPair.IntendedPersonName == nil || *friendPair.IntendedPersonName != "Cam" {
		t.Fatalf("Friend Pair creation status=%d body=%s", friendResponse.Code, friendResponse.Body.String())
	}

	spaces := performDomainRequest(router, http.MethodGet, "/api/v1/pairs", nil, cookie)
	var listed []spaceProjection
	if spaces.Code != http.StatusOK || json.Unmarshal(spaces.Body.Bytes(), &listed) != nil || len(listed) != 2 {
		t.Fatalf("Spaces response status=%d body=%s", spaces.Code, spaces.Body.String())
	}
	for _, space := range listed {
		if space.State != "waiting" || space.OtherParticipantDisplayName != nil || space.IntendedPersonName == nil {
			t.Fatalf("unclaimed Space projection = %+v", space)
		}
	}

	entry := performDomainRequest(router, http.MethodGet, "/api/v1/pairs/"+pairID, nil, cookie)
	var pairEntry pairEntryResponse
	if entry.Code != http.StatusOK || json.Unmarshal(entry.Body.Bytes(), &pairEntry) != nil || pairEntry.RelationshipType != "partner" || pairEntry.State != "waiting" || len(pairEntry.Members) != 1 || pairEntry.Members[0].Slot != "first" || pairEntry.Members[0].DisplayName != canonicalName {
		t.Fatalf("Pair detail response status=%d body=%s", entry.Code, entry.Body.String())
	}
	status := performDomainRequest(router, http.MethodGet, "/api/v1/pairs/"+pairID+"/status", nil, cookie)
	if status.Code != http.StatusOK || status.Body.String() != "{\"state\":\"waiting\"}\n" {
		t.Fatalf("Pair status = %d %s", status.Code, status.Body.String())
	}

	patch := performDomainRequest(router, http.MethodPatch, "/api/v1/pairs/"+pairID, map[string]string{
		"intendedPersonName": "  Bea Two  ",
	}, cookie)
	var patchBody updatePairResponse
	if patch.Code != http.StatusOK || json.Unmarshal(patch.Body.Bytes(), &patchBody) != nil || patchBody.IntendedPersonName == nil || *patchBody.IntendedPersonName != "Bea Two" {
		t.Fatalf("Pair intended-name update status=%d body=%s", patch.Code, patch.Body.String())
	}
	unsupportedRelationshipUpdate := performDomainRequest(router, http.MethodPatch, "/api/v1/pairs/"+pairID, map[string]string{
		"intendedPersonName": "Bea Three", "relationshipType": "friend",
	}, cookie)
	if unsupportedRelationshipUpdate.Code != http.StatusBadRequest {
		t.Fatalf("relationship change was accepted: %d %s", unsupportedRelationshipUpdate.Code, unsupportedRelationshipUpdate.Body.String())
	}

	// GO-05 adds invitation storage, while Pair creation remains lazy.
	if !inviteRelationExists(t, pool) {
		t.Fatal("GO-05 initial invitation table is missing")
	}
	if countForPair(t, pool, "initial_invite", pairID) != 0 {
		t.Fatal("Pair creation issued an invitation before an explicit request")
	}
	if countForPair(t, pool, "pair_membership_era", pairID) != 0 {
		t.Fatal("creator-only Pair creation started a membership era")
	}
	if countForPair(t, pool, "pair_membership", pairID) != 1 {
		t.Fatal("Pair creation did not persist exactly the creator membership")
	}
	assertSecondSelfMembershipRejected(t, pool, pairID, participantID)

	// A different Participant cannot read the Pair or learn its intended label.
	otherCookie := createAnonymousTestCookie(t, router)
	otherOnboarding := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{"displayName": "Nia"}, otherCookie)
	if otherOnboarding.Code != http.StatusOK {
		t.Fatalf("unrelated Participant onboarding status=%d %s", otherOnboarding.Code, otherOnboarding.Body.String())
	}
	unrelatedRead := performDomainRequest(router, http.MethodGet, "/api/v1/pairs/"+pairID, nil, otherCookie)
	if unrelatedRead.Code != http.StatusNotFound {
		t.Fatalf("unrelated Pair read status=%d body=%s", unrelatedRead.Code, unrelatedRead.Body.String())
	}
	unrelatedSpaces := performDomainRequest(router, http.MethodGet, "/api/v1/pairs", nil, otherCookie)
	if unrelatedSpaces.Code != http.StatusOK || unrelatedSpaces.Body.String() != "[]\n" {
		t.Fatalf("unrelated Spaces projection = %d %s", unrelatedSpaces.Code, unrelatedSpaces.Body.String())
	}

	// The required ownership-parity sequence: Pair X exists before upgrade;
	// attaching credentials to A leaves its UUID, Participant, and membership.
	upgrade := performDomainRequest(router, http.MethodPost, "/api/v1/auth/upgrade", map[string]string{
		"email": "go04-" + createRequestID + "@example.test", "password": "Valid-passphrase-2040",
	}, cookie)
	if upgrade.Code != http.StatusOK {
		t.Fatalf("anonymous credential upgrade status=%d body=%s", upgrade.Code, upgrade.Body.String())
	}
	upgradedMe := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, cookie)
	var upgradedProjection meResponse
	if upgradedMe.Code != http.StatusOK || json.Unmarshal(upgradedMe.Body.Bytes(), &upgradedProjection) != nil || upgradedProjection.Actor == nil || upgradedProjection.Actor.AuthUserID != authUserID || upgradedProjection.Actor.Kind != auth.UserKindRegistered || upgradedProjection.Actor.Participant == nil || upgradedProjection.Actor.Participant.ParticipantID != participantID {
		t.Fatalf("post-upgrade actor projection = %s", upgradedMe.Body.String())
	}
	if count := participantCountForAuthUser(t, pool, authUserID); count != 1 {
		t.Fatalf("auth upgrade produced %d Participants", count)
	}
	if count := pairMembershipCountForParticipant(t, pool, participantID); count != 2 {
		t.Fatalf("Pair memberships changed across auth upgrade: count=%d", count)
	}
	listedAfterUpgrade := performDomainRequest(router, http.MethodGet, "/api/v1/pairs", nil, cookie)
	var afterUpgradeSpaces []spaceProjection
	if listedAfterUpgrade.Code != http.StatusOK || json.Unmarshal(listedAfterUpgrade.Body.Bytes(), &afterUpgradeSpaces) != nil || len(afterUpgradeSpaces) != 2 {
		t.Fatalf("post-upgrade Spaces = %d %s", listedAfterUpgrade.Code, listedAfterUpgrade.Body.String())
	}
	var idCount int
	for _, item := range afterUpgradeSpaces {
		if item.PairID == pairID || item.PairID == friendPair.PairID {
			idCount++
		}
	}
	if idCount != 2 {
		t.Fatalf("Pair ownership changed across auth upgrade: %+v", afterUpgradeSpaces)
	}

	// Terminated former-member reads preserve the current product's minimal
	// terminal projection. This fixture writes the state directly; no GO-06
	// termination command is introduced here.
	terminatedPairID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pair.NewService(postgrespair.NewStore(pool)).Create(ctx, pair.CreateInput{
		ParticipantID: participantID, IntendedPersonName: "History", RelationshipType: "friend",
		ClientRequestID: terminatedPairID,
	}); err != nil {
		t.Fatalf("create terminal-state fixture: %v", err)
	}
	var terminalID string
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		return db.QueryRow(ctx, "SELECT id::text FROM pair WHERE creation_request_id = $1", terminatedPairID).Scan(&terminalID)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		if _, err := db.Exec(ctx, "UPDATE pair SET terminated_at = now() WHERE id = $1", terminalID); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "UPDATE pair_membership SET ended_at = now() WHERE pair_id = $1", terminalID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	terminalRead := performDomainRequest(router, http.MethodGet, "/api/v1/pairs/"+terminalID, nil, cookie)
	var terminalEntry pairEntryResponse
	if terminalRead.Code != http.StatusOK || json.Unmarshal(terminalRead.Body.Bytes(), &terminalEntry) != nil || terminalEntry.State != "terminated" || terminalEntry.RelationshipType != "" || len(terminalEntry.Members) != 0 {
		t.Fatalf("terminated Pair projection = %d %s", terminalRead.Code, terminalRead.Body.String())
	}
}

func TestInitialInviteExplicitClaimCreatesFirstEraAndStoresOnlyHash(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	creatorCookie := createAnonymousTestCookie(t, router)
	creatorOnboard := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{"displayName": "Creator"}, creatorCookie)
	var creator onboardingResponse
	if creatorOnboard.Code != http.StatusOK || json.Unmarshal(creatorOnboard.Body.Bytes(), &creator) != nil {
		t.Fatalf("creator onboarding: %d %s", creatorOnboard.Code, creatorOnboard.Body.String())
	}
	createdPair := performDomainRequest(router, http.MethodPost, "/api/v1/pairs", map[string]string{"intendedPersonName": "Rae", "relationshipType": "friend"}, creatorCookie)
	var pairResult createPairResponse
	if createdPair.Code != http.StatusOK || json.Unmarshal(createdPair.Body.Bytes(), &pairResult) != nil {
		t.Fatalf("Pair creation: %d %s", createdPair.Code, createdPair.Body.String())
	}
	issuedResponse := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+pairResult.PairID+"/invite", nil, creatorCookie)
	var issued inviteStateResponse
	if issuedResponse.Code != http.StatusCreated || json.Unmarshal(issuedResponse.Body.Bytes(), &issued) != nil || issued.Token == "" {
		t.Fatalf("issue invite: %d %s", issuedResponse.Code, issuedResponse.Body.String())
	}
	if !strings.Contains(issuedResponse.Header().Get("Set-Cookie"), "HttpOnly") {
		t.Fatalf("raw invite was not retained in an HttpOnly cookie: %q", issuedResponse.Header().Get("Set-Cookie"))
	}
	preview := performDomainRequest(router, http.MethodGet, "/api/v1/invites/"+issued.Token, nil, nil)
	var landing inviteLandingResponse
	if preview.Code != http.StatusOK || json.Unmarshal(preview.Body.Bytes(), &landing) != nil || landing.InviterDisplayName != "Creator" || landing.IntendedPersonName == nil || *landing.IntendedPersonName != "Rae" {
		t.Fatalf("preview: %d %s", preview.Code, preview.Body.String())
	}
	previewAgain := performDomainRequest(router, http.MethodGet, "/api/v1/invites/"+issued.Token, nil, nil)
	if previewAgain.Code != http.StatusOK {
		t.Fatalf("repeat preview consumed invite: %d %s", previewAgain.Code, previewAgain.Body.String())
	}
	selfClaim := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+issued.Token+"/redeem", nil, creatorCookie)
	if selfClaim.Code != http.StatusConflict || countForPair(t, pool, "pair_membership", pairResult.PairID) != 1 {
		t.Fatalf("creator self-claim changed Pair state: %d %s", selfClaim.Code, selfClaim.Body.String())
	}
	tampered := "A" + issued.Token[1:]
	if tampered == issued.Token {
		tampered = "B" + issued.Token[1:]
	}
	if denied := performDomainRequest(router, http.MethodGet, "/api/v1/invites/"+tampered, nil, nil); denied.Code != http.StatusNotFound {
		t.Fatalf("tampered credential preview status=%d body=%s", denied.Code, denied.Body.String())
	}
	replacedResponse := performDomainRequest(router, http.MethodPut, "/api/v1/pairs/"+pairResult.PairID+"/invite", nil, creatorCookie)
	var replaced inviteStateResponse
	if replacedResponse.Code != http.StatusCreated || json.Unmarshal(replacedResponse.Body.Bytes(), &replaced) != nil || replaced.Token == "" || replaced.Token == issued.Token {
		t.Fatalf("explicit invite replacement: %d %s", replacedResponse.Code, replacedResponse.Body.String())
	}
	if stale := performDomainRequest(router, http.MethodGet, "/api/v1/invites/"+issued.Token, nil, nil); stale.Code != http.StatusNotFound {
		t.Fatalf("replaced credential remained valid: %d %s", stale.Code, stale.Body.String())
	}
	issued = replaced
	inviteeCookie := createAnonymousTestCookie(t, router)
	joined := performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+issued.Token+"/redeem", map[string]string{"displayName": "Actual name"}, inviteeCookie)
	var claim inviteClaimResponse
	if joined.Code != http.StatusOK || json.Unmarshal(joined.Body.Bytes(), &claim) != nil || claim.PairID != pairResult.PairID || claim.MembershipEraID == "" {
		t.Fatalf("claim: %d %s", joined.Code, joined.Body.String())
	}
	inviteeMe := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, inviteeCookie)
	var inviteeActor meResponse
	if inviteeMe.Code != http.StatusOK || json.Unmarshal(inviteeMe.Body.Bytes(), &inviteeActor) != nil || inviteeActor.Actor == nil || inviteeActor.Actor.Participant == nil || inviteeActor.Actor.Participant.DisplayName != "Actual name" {
		t.Fatalf("inline claimant onboarding projection: %d %s", inviteeMe.Code, inviteeMe.Body.String())
	}
	if got := pairMembershipCountForParticipant(t, pool, inviteeActor.Actor.Participant.ParticipantID); got != 1 {
		t.Fatalf("invitee active membership count=%d", got)
	}
	digest := sha256.Sum256([]byte(issued.Token))
	var storedHash []byte
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT token_hash FROM initial_invite WHERE pair_id=$1 ORDER BY created_at DESC LIMIT 1", pairResult.PairID).Scan(&storedHash)
	}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedHash, digest[:]) || bytes.Equal(storedHash, []byte(issued.Token)) {
		t.Fatalf("invite token persistence did not contain only its SHA-256 hash")
	}
	var activeMembers, activeEras int
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		if err := db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership WHERE pair_id=$1 AND ended_at IS NULL", pairResult.PairID).Scan(&activeMembers); err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership_era WHERE pair_id=$1 AND ended_at IS NULL", pairResult.PairID).Scan(&activeEras)
	}); err != nil {
		t.Fatal(err)
	}
	if activeMembers != 2 || activeEras != 1 {
		t.Fatalf("post-claim active members/eras=%d/%d", activeMembers, activeEras)
	}
	var intended *string
	if err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT intended_person_name FROM pair WHERE id=$1", pairResult.PairID).Scan(&intended)
	}); err != nil {
		t.Fatal(err)
	}
	if intended != nil {
		t.Fatalf("claim retained intended-person label: %q", *intended)
	}
	meBefore := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, creatorCookie)
	var beforeUpgrade meResponse
	if meBefore.Code != http.StatusOK || json.Unmarshal(meBefore.Body.Bytes(), &beforeUpgrade) != nil || beforeUpgrade.Actor == nil {
		t.Fatalf("pre-upgrade actor: %d %s", meBefore.Code, meBefore.Body.String())
	}
	upgrade := performDomainRequest(router, http.MethodPost, "/api/v1/auth/upgrade", map[string]string{
		"email": "go05-" + strings.ReplaceAll(pairResult.PairID, "-", "") + "@example.test", "password": "Valid-passphrase-2040",
	}, creatorCookie)
	if upgrade.Code != http.StatusOK {
		t.Fatalf("creator credential upgrade: %d %s", upgrade.Code, upgrade.Body.String())
	}
	meAfter := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, creatorCookie)
	var afterUpgrade meResponse
	if meAfter.Code != http.StatusOK || json.Unmarshal(meAfter.Body.Bytes(), &afterUpgrade) != nil || afterUpgrade.Actor == nil || afterUpgrade.Actor.AuthUserID != beforeUpgrade.Actor.AuthUserID || afterUpgrade.Actor.Participant == nil || afterUpgrade.Actor.Participant.ParticipantID != creator.ParticipantID {
		t.Fatalf("post-claim credential upgrade changed ownership: %d %s", meAfter.Code, meAfter.Body.String())
	}
	if countForPair(t, pool, "pair_membership", pairResult.PairID) != 2 || countForPair(t, pool, "pair_membership_era", pairResult.PairID) != 1 || countForPair(t, pool, "initial_invite", pairResult.PairID) != 2 {
		t.Fatal("credential upgrade changed claim membership, era, or redeemed invite rows")
	}
}

func TestInitialClaimRaceForSameInviteCreatesOneEra(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	creator := createOnboardedTestActor(t, router, "Race creator")
	pairResponse := performDomainRequest(router, http.MethodPost, "/api/v1/pairs", map[string]string{"intendedPersonName": "Claimant", "relationshipType": "partner"}, creator.cookie)
	var created createPairResponse
	if pairResponse.Code != http.StatusOK || json.Unmarshal(pairResponse.Body.Bytes(), &created) != nil {
		t.Fatalf("create Pair: %d %s", pairResponse.Code, pairResponse.Body.String())
	}
	issue := performDomainRequest(router, http.MethodPost, "/api/v1/pairs/"+created.PairID+"/invite", nil, creator.cookie)
	var inviteBody inviteStateResponse
	if issue.Code != http.StatusCreated || json.Unmarshal(issue.Body.Bytes(), &inviteBody) != nil {
		t.Fatalf("issue invite: %d %s", issue.Code, issue.Body.String())
	}
	a := createOnboardedTestActor(t, router, "Claimant A")
	b := createOnboardedTestActor(t, router, "Claimant B")
	responses := make(chan int, 2)
	var wait sync.WaitGroup
	for _, actor := range []testHTTPActor{a, b} {
		wait.Add(1)
		go func(actor testHTTPActor) {
			defer wait.Done()
			responses <- performDomainRequest(router, http.MethodPost, "/api/v1/invites/"+inviteBody.Token+"/redeem", nil, actor.cookie).Code
		}(actor)
	}
	wait.Wait()
	close(responses)
	successes, conflicts := 0, 0
	for status := range responses {
		if status == http.StatusOK {
			successes++
		} else if status == http.StatusConflict {
			conflicts++
		} else {
			t.Fatalf("unexpected concurrent claim status %d", status)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("same-invite race successes/conflicts=%d/%d", successes, conflicts)
	}
	if countForPair(t, pool, "pair_membership", created.PairID) != 2 || countForPair(t, pool, "pair_membership_era", created.PairID) != 1 {
		t.Fatal("same-invite race produced partial or duplicate membership-era state")
	}
}

type testHTTPActor struct {
	cookie        *http.Cookie
	participantID string
}

func createOnboardedTestActor(t *testing.T, router http.Handler, name string) testHTTPActor {
	t.Helper()
	cookie := createAnonymousTestCookie(t, router)
	response := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{"displayName": name}, cookie)
	var result onboardingResponse
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatalf("onboard %q: %d %s", name, response.Code, response.Body.String())
	}
	return testHTTPActor{cookie: cookie, participantID: result.ParticipantID}
}

func TestAdminActorNeverResolvesOrCreatesParticipant(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	router, _ := newParticipantPairRouter(pool)
	adminUserID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	adminSessionID, err := auth.NewID()
	if err != nil {
		t.Fatal(err)
	}
	token, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	adminUUID := parseTestUUID(t, adminUserID)
	sessionUUID := parseTestUUID(t, adminSessionID)
	hash := auth.HashSessionToken(token)
	if err := pool.WithinTx(context.Background(), func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		if _, err := queries.CreateAuthUser(context.Background(), sqlc.CreateAuthUserParams{
			ID: adminUUID, Kind: string(auth.UserKindAdmin), CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			return err
		}
		if err := queries.CreateAdminUser(context.Background(), sqlc.CreateAdminUserParams{
			AuthUserID: adminUUID, CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
		}); err != nil {
			return err
		}
		_, err := queries.CreateAuthSession(context.Background(), sqlc.CreateAuthSessionParams{
			ID: sessionUUID, AuthUserID: adminUUID, TokenHash: hash[:],
			CreatedAt: pgtype.Timestamptz{Time: now, Valid: true}, ExpiresAt: pgtype.Timestamptz{Time: now.Add(auth.SessionIdleTTL), Valid: true},
		})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	adminCookie := &http.Cookie{Name: auth.SessionCookieName, Value: token}
	me := performDomainRequest(router, http.MethodGet, "/api/v1/me", nil, adminCookie)
	var adminProjection meResponse
	if me.Code != http.StatusOK || json.Unmarshal(me.Body.Bytes(), &adminProjection) != nil || adminProjection.Actor == nil || adminProjection.Actor.Kind != auth.UserKindAdmin || adminProjection.Actor.Participant != nil {
		t.Fatalf("Admin /me projection = %d %s", me.Code, me.Body.String())
	}
	onboarding := performDomainRequest(router, http.MethodPost, "/api/v1/onboarding", map[string]string{"displayName": "Should Not Exist"}, adminCookie)
	if onboarding.Code != http.StatusForbidden {
		t.Fatalf("Admin onboarding status=%d body=%s", onboarding.Code, onboarding.Body.String())
	}
	if count := participantCountForAuthUser(t, pool, adminUserID); count != 0 {
		t.Fatalf("Admin actor created %d Participants", count)
	}
}

func participantCountForAuthUser(t *testing.T, pool *postgres.Pool, authUserID string) int {
	t.Helper()
	var count int
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM participant WHERE auth_user_id = $1", authUserID).Scan(&count)
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func countForPair(t *testing.T, pool *postgres.Pool, table, pairID string) int {
	t.Helper()
	var count int
	query := "SELECT count(*) FROM " + table + " WHERE pair_id = $1"
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), query, pairID).Scan(&count)
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func pairMembershipCountForParticipant(t *testing.T, pool *postgres.Pool, participantID string) int {
	t.Helper()
	var count int
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT count(*) FROM pair_membership WHERE participant_id = $1", participantID).Scan(&count)
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func inviteRelationExists(t *testing.T, pool *postgres.Pool) bool {
	t.Helper()
	var relation *string
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT to_regclass('public.initial_invite')::text").Scan(&relation)
	})
	if err != nil {
		t.Fatal(err)
	}
	return relation != nil
}

func assertSecondSelfMembershipRejected(t *testing.T, pool *postgres.Pool, pairID, participantID string) {
	t.Helper()
	err := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, err := db.Exec(context.Background(), "INSERT INTO pair_membership (pair_id, participant_id, slot) VALUES ($1, $2, 'second')", pairID, participantID)
		return err
	})
	if err == nil {
		t.Fatal("database allowed one Participant to occupy both Pair slots")
	}
	var pgErr interface{ SQLState() string }
	if !errors.As(err, &pgErr) || pgErr.SQLState() != "23505" {
		t.Fatalf("second-slot self-membership error = %v, want unique violation", err)
	}
	thirdSlotErr := pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		_, err := db.Exec(context.Background(), "INSERT INTO pair_membership (pair_id, participant_id, slot) VALUES ($1, $2, 'third')", pairID, participantID)
		return err
	})
	if thirdSlotErr == nil {
		t.Fatal("database allowed a third logical Pair slot")
	}
}

func parseTestUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	var result pgtype.UUID
	if err := result.Scan(value); err != nil {
		t.Fatal(err)
	}
	return result
}
