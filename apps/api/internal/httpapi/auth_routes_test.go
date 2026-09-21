package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
)

type routeSessionStore struct {
	createCount int
	userID      string
	sessionID   string
	tokenHash   []byte
	state       auth.SessionState
	revoked     bool
}

func (store *routeSessionStore) CreateAnonymous(_ context.Context, userID, sessionID string, tokenHash []byte, createdAt, expiresAt time.Time) error {
	store.createCount++
	store.userID = userID
	store.sessionID = sessionID
	store.tokenHash = append([]byte(nil), tokenHash...)
	store.state = auth.SessionState{
		Actor:      auth.Actor{AuthUserID: userID, Kind: auth.UserKindAnonymous},
		SessionID:  sessionID,
		CreatedAt:  createdAt,
		ExpiresAt:  expiresAt,
		LastUsedAt: createdAt,
	}
	return nil
}

func (store *routeSessionStore) FindSession(_ context.Context, tokenHash []byte, now time.Time) (auth.SessionState, error) {
	if store.revoked || !bytes.Equal(store.tokenHash, tokenHash) || !store.state.ExpiresAt.After(now) {
		return auth.SessionState{}, auth.ErrUnauthenticated
	}
	return store.state, nil
}

func (store *routeSessionStore) RenewSession(_ context.Context, _ string, _ time.Time, expiresAt time.Time) error {
	store.state.ExpiresAt = expiresAt
	return nil
}

func (store *routeSessionStore) RevokeSession(_ context.Context, tokenHash []byte, _ time.Time) error {
	if bytes.Equal(store.tokenHash, tokenHash) {
		store.revoked = true
	}
	return nil
}

func (store *routeSessionStore) DeleteExpiredSessions(_ context.Context, _ time.Time, _ int32) (int64, error) {
	return 0, nil
}

func TestAnonymousEndpointIssuesOpaqueHttpOnlyCookie(t *testing.T) {
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	store := &routeSessionStore{}
	service := auth.NewServiceWithClock(store, func() time.Time { return now })
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{TrustedOrigins: []string{"http://localhost:5173", "https://closer.example"}})

	for _, test := range []struct {
		name   string
		origin string
		secure bool
	}{
		{name: "local development", origin: "http://localhost:5173"},
		{name: "production", origin: "https://closer.example", secure: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/anonymous", nil)
			request.Header.Set("Origin", test.origin)
			router.ServeHTTP(response, request)

			if response.Code != http.StatusCreated {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			cookie := onlySessionCookie(t, response)
			if !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode || cookie.Secure != test.secure {
				t.Fatalf("cookie attributes = %+v", cookie)
			}
			if !cookie.Expires.Equal(now.Add(auth.SessionIdleTTL)) {
				t.Fatalf("cookie expiry = %s", cookie.Expires)
			}
			if cookie.Value == "" || len(store.tokenHash) != sha256.Size || bytes.Equal(store.tokenHash, []byte(cookie.Value)) {
				t.Fatal("raw session token was not isolated to the cookie")
			}
			if bytes.Contains(response.Body.Bytes(), []byte(cookie.Value)) || bytes.Contains(response.Body.Bytes(), []byte("closer_session")) {
				t.Fatalf("response body exposed cookie material: %s", response.Body.String())
			}
			var body meResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Actor == nil || body.Actor.Kind != auth.UserKindAnonymous || body.Actor.AuthUserID != store.userID {
				t.Fatalf("actor projection = %+v", body.Actor)
			}
			if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
				t.Fatalf("Cache-Control = %q", got)
			}
		})
	}
}

func TestAnonymousEndpointRequiresExactConfiguredOrigin(t *testing.T) {
	store := &routeSessionStore{}
	router := NewRouterWithAuth(nil, nil, auth.NewService(store), SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	for _, origin := range []string{"", "null", "https://closer.example.evil.test", "https://closer.example/"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/anonymous", nil)
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("origin %q status = %d, want 403", origin, response.Code)
		}
	}
	if store.createCount != 0 {
		t.Fatalf("created anonymous identities for rejected origins: %d", store.createCount)
	}
}

func TestMeIsReadOnlyAndProjectsOnlyTheAuthenticatedActor(t *testing.T) {
	now := time.Now().UTC()
	store := &routeSessionStore{}
	service := auth.NewServiceWithClock(store, func() time.Time { return now })
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))
	if response.Code != http.StatusOK || store.createCount != 0 || len(response.Result().Cookies()) != 0 {
		t.Fatalf("unauthenticated GET /me status = %d, creations = %d", response.Code, store.createCount)
	}
	var anonymous meResponse
	if err := json.Unmarshal(response.Body.Bytes(), &anonymous); err != nil || anonymous.Actor != nil {
		t.Fatalf("anonymous projection = %+v, error = %v", anonymous, err)
	}

	token, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	hash := auth.HashSessionToken(token)
	store.tokenHash = hash[:]
	store.state = auth.SessionState{
		Actor:      auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000001", Kind: auth.UserKindAnonymous},
		SessionID:  "00000000-0000-4000-8000-000000000002",
		CreatedAt:  now.Add(-48 * time.Hour),
		ExpiresAt:  now.Add(auth.SessionIdleTTL),
		LastUsedAt: now.Add(-48 * time.Hour),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || len(response.Result().Cookies()) != 0 {
		t.Fatalf("authenticated GET /me status = %d, cookies = %v", response.Code, response.Result().Cookies())
	}
	if !store.state.ExpiresAt.Equal(now.Add(auth.SessionIdleTTL)) {
		t.Fatal("safe GET /me renewed session state")
	}
	var actor meResponse
	if err := json.Unmarshal(response.Body.Bytes(), &actor); err != nil || actor.Actor == nil || actor.Actor.AuthUserID != store.state.Actor.AuthUserID {
		t.Fatalf("authenticated actor projection = %+v, error = %v", actor, err)
	}
}

func TestInvalidOrRevokedSessionIsUnauthenticatedAndLogoutClearsCookie(t *testing.T) {
	now := time.Now().UTC()
	store := &routeSessionStore{}
	service := auth.NewServiceWithClock(store, func() time.Time { return now })
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})

	token, err := auth.NewSessionToken(nil)
	if err != nil {
		t.Fatal(err)
	}
	hash := auth.HashSessionToken(token)
	store.tokenHash = hash[:]
	store.state = auth.SessionState{
		Actor:      auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000001", Kind: auth.UserKindAnonymous},
		SessionID:  "00000000-0000-4000-8000-000000000002",
		CreatedAt:  now,
		ExpiresAt:  now.Add(auth.SessionIdleTTL),
		LastUsedAt: now,
	}
	store.revoked = true
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var result meResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Actor != nil {
		t.Fatalf("revoked session projection = %+v, error = %v", result, err)
	}

	logout := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	logout.Header.Set("Origin", "https://closer.example")
	logout.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, logout)
	if response.Code != http.StatusOK {
		t.Fatalf("logout status = %d, body = %s", response.Code, response.Body.String())
	}
	cookie := onlySessionCookie(t, response)
	if cookie.MaxAge >= 0 || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode || !cookie.Secure {
		t.Fatalf("logout cookie did not expire securely: %+v", cookie)
	}
}

func TestGetPrefetchLikeRoutesNeverCreateAnonymousIdentity(t *testing.T) {
	store := &routeSessionStore{}
	router := NewRouterWithAuth(nil, nil, auth.NewService(store), SecurityConfig{})
	for _, path := range []string{"/api/v1/me", "/api/v1/invites/example-token", "/api/v1/rejoin/example-token"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if store.createCount != 0 {
			t.Fatalf("GET %s created an auth identity", path)
		}
	}
}

func onlySessionCookie(t *testing.T, response *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	var sessionCookies []*http.Cookie
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == auth.SessionCookieName {
			sessionCookies = append(sessionCookies, cookie)
		}
	}
	if len(sessionCookies) != 1 {
		t.Fatalf("session cookie count = %d, want one", len(sessionCookies))
	}
	return sessionCookies[0]
}
