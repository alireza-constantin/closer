package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/adminanalytics"
	"github.com/alireza-constantin/closer/apps/api/internal/auth"
)

type analyticsRouteRepository struct {
	private  *adminanalytics.PrivateAggregate
	together *adminanalytics.TogetherAggregate
}

func (r analyticsRouteRepository) SelectRevision(context.Context, string, adminanalytics.Scope, string) (adminanalytics.RevisionSelection, error) {
	return adminanalytics.RevisionSelection{SelectedRevisionID: "11111111-1111-4111-8111-111111111111", SelectedRevisionNumber: 1}, nil
}
func (r analyticsRouteRepository) PrivateAggregate(context.Context, string, string, adminanalytics.Scope) (*adminanalytics.PrivateAggregate, error) {
	return r.private, nil
}
func (r analyticsRouteRepository) TogetherAggregate(context.Context, string, string, adminanalytics.Scope) (*adminanalytics.TogetherAggregate, error) {
	return r.together, nil
}
func (analyticsRouteRepository) Coverage(context.Context) ([]adminanalytics.CoverageLane, error) {
	return nil, nil
}

func TestSuppressedAnalyticsJSONOmitsMetricComponents(t *testing.T) {
	response := questionAnalyticsResponse{QuestionID: "q", RevisionScope: "current", Private: privateProjection(nil), Together: togetherProjection(nil)}
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	value := string(body)
	for _, hidden := range []string{"numerator", "denominator", "rate", "validOffers", "decisions", "shown", "pairId", "participantId", "sessionId"} {
		if strings.Contains(value, hidden) {
			t.Errorf("suppressed JSON exposes %q: %s", hidden, value)
		}
	}
	if !strings.Contains(value, `"status":"insufficient_data"`) {
		t.Fatalf("missing suppression state: %s", value)
	}
}

func TestAnalyticsZeroDenominatorsAreExplicitlyUnavailable(t *testing.T) {
	private := privateProjection(&adminanalytics.PrivateAggregate{ValidOffers: 0, Decisions: 0})
	together := togetherProjection(&adminanalytics.TogetherAggregate{Shown: 3, Decisions: 0})
	if private.DecisionRate.Status != "unavailable" || private.AskRate.Status != "unavailable" || private.LikeRate.Status != "unavailable" {
		t.Fatalf("private zero-denominator rates = %+v", private)
	}
	if together.ContinueRate.Status != "unavailable" || together.SkipRate.Status != "unavailable" || together.LikeRate.Status != "unavailable" {
		t.Fatalf("Together zero-denominator rates = %+v", together)
	}
	body, err := json.Marshal(private)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "NaN") || strings.Contains(string(body), "Infinity") {
		t.Fatalf("non-finite rate serialized: %s", body)
	}
}

func TestAdminAnalyticsHTTPJSONSuppressesHiddenValuesAndRejectsConsumer(t *testing.T) {
	store := newRouteCredentialStore()
	store.activeSession = true
	const adminID = "22222222-2222-4222-8222-222222222222"
	token, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	store.userID = adminID
	store.tokenHash = sha256Token(token)
	store.state = auth.SessionState{Actor: auth.Actor{AuthUserID: adminID, Kind: auth.UserKindAdmin}, SessionID: "session-id", ExpiresAt: time.Now().Add(time.Hour)}
	store.userKinds[adminID] = auth.UserKindAdmin
	service := auth.NewServiceWithCredentials(store, store, routePasswordHasher{})
	if _, err := service.ResolveSession(context.Background(), token); err != nil {
		t.Fatalf("test admin session rejected: %v", err)
	}
	repository := &analyticsRouteRepository{}
	analytics := adminanalytics.NewService(repository)
	router := NewRouterWithPrivateAndTogetherRealtime(nil, nil, service, nil, nil, nil, nil, nil, nil, nil, nil, SecurityConfig{}, analytics)
	path := "/api/v1/admin/questions/33333333-3333-4333-8333-333333333333/analytics"

	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("Admin analytics status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("Admin analytics cache header = %q", response.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	serialized, _ := json.Marshal(body)
	for _, hidden := range []string{"numerator", "denominator", "rate", "validOffers", "decisions", "shown", "pairId", "participantId", "sessionId"} {
		if strings.Contains(string(serialized), hidden) {
			t.Errorf("suppressed HTTP JSON exposes %q: %s", hidden, serialized)
		}
	}
	if !strings.Contains(string(serialized), `"status":"insufficient_data"`) {
		t.Fatalf("missing suppression state: %s", serialized)
	}

	repository.private = &adminanalytics.PrivateAggregate{ValidOffers: 5, Decisions: 4, Asked: 3, Skipped: 1, LikedDecisions: 2}
	repository.together = &adminanalytics.TogetherAggregate{Shown: 5, Decisions: 4, Continued: 3, Skipped: 1, LikedDecisions: 2}
	request = httptest.NewRequest(http.MethodGet, path, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("available analytics status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"status":"available"`) || !strings.Contains(response.Body.String(), `"numerator":`) || !strings.Contains(response.Body.String(), `"denominator":`) || !strings.Contains(response.Body.String(), `"rate":`) {
		t.Fatalf("available serialized metrics lack their contract values: %s", response.Body.String())
	}
	for _, forbidden := range []string{"pairId", "participantId", "membershipId", "sessionId", "answer", "reply", "displayName", "invite", "token"} {
		if strings.Contains(strings.ToLower(response.Body.String()), strings.ToLower(forbidden)) {
			t.Errorf("available analytics response contains personal or drilldown field %q: %s", forbidden, response.Body.String())
		}
	}

	store.state.Actor.Kind = auth.UserKindAnonymous
	store.userKinds[adminID] = auth.UserKindAnonymous
	request = httptest.NewRequest(http.MethodGet, path, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("consumer status=%d body=%s, want 403", response.Code, response.Body.String())
	}
}

func sha256Token(value string) []byte {
	hash := sha256.Sum256([]byte(value))
	return hash[:]
}
