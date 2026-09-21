package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestCredentialRoutesRegisterUpgradeLoginAndLogoutAll(t *testing.T) {
	now := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
	store := newRouteCredentialStore()
	service := auth.NewServiceWithCredentialsAndClock(store, store, routePasswordHasher{}, func() time.Time { return now })
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})

	register := credentialRequest(t, router, "/api/v1/auth/register", "https://closer.example", "", `{"email":"New.User@Example.com","password":"correct horse"}`)
	if register.Code != http.StatusCreated {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	registeredCookie := onlySessionCookie(t, register)
	if !registeredCookie.HttpOnly || !registeredCookie.Secure || registeredCookie.Path != "/" || registeredCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("registration cookie attributes = %+v", registeredCookie)
	}
	var registered meResponse
	if err := json.Unmarshal(register.Body.Bytes(), &registered); err != nil || registered.Actor == nil || registered.Actor.Kind != auth.UserKindRegistered {
		t.Fatalf("register projection=%+v error=%v", registered, err)
	}
	if bytes.Contains(register.Body.Bytes(), []byte("new.user@example.com")) || bytes.Contains(register.Body.Bytes(), []byte("correct horse")) || bytes.Contains(register.Body.Bytes(), []byte(registeredCookie.Value)) {
		t.Fatalf("register response exposed credential material: %s", register.Body.String())
	}
	if _, ok := store.credentials["new.user@example.com"]; !ok {
		t.Fatal("registration did not normalize email")
	}

	anonymousResponse := httptest.NewRecorder()
	anonymousRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/anonymous", nil)
	anonymousRequest.Header.Set("Origin", "https://closer.example")
	router.ServeHTTP(anonymousResponse, anonymousRequest)
	if anonymousResponse.Code != http.StatusCreated {
		t.Fatalf("anonymous status=%d body=%s", anonymousResponse.Code, anonymousResponse.Body.String())
	}
	anonymousCookie := onlySessionCookie(t, anonymousResponse)
	var anonymous meResponse
	if err := json.Unmarshal(anonymousResponse.Body.Bytes(), &anonymous); err != nil || anonymous.Actor == nil {
		t.Fatalf("anonymous projection=%+v error=%v", anonymous, err)
	}

	upgrade := credentialRequest(t, router, "/api/v1/auth/upgrade", "https://closer.example", anonymousCookie.Value, `{"email":"Upgrade.User@Example.com","password":"correct horse"}`)
	if upgrade.Code != http.StatusOK || len(upgrade.Result().Cookies()) != 0 {
		t.Fatalf("upgrade status=%d cookies=%v body=%s", upgrade.Code, upgrade.Result().Cookies(), upgrade.Body.String())
	}
	var upgraded meResponse
	if err := json.Unmarshal(upgrade.Body.Bytes(), &upgraded); err != nil || upgraded.Actor == nil || upgraded.Actor.AuthUserID != anonymous.Actor.AuthUserID || upgraded.Actor.Kind != auth.UserKindRegistered {
		t.Fatalf("upgrade projection=%+v error=%v", upgraded, err)
	}
	if store.state.Actor.AuthUserID != anonymous.Actor.AuthUserID || store.state.Actor.Kind != auth.UserKindRegistered {
		t.Fatalf("upgrade changed identity/session: %+v", store.state)
	}

	// Start another anonymous browser, then sign it into the already registered
	// user. Its old identity survives while only that browser session is revoked.
	anotherAnonymous := httptest.NewRecorder()
	anotherRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/anonymous", nil)
	anotherRequest.Header.Set("Origin", "https://closer.example")
	router.ServeHTTP(anotherAnonymous, anotherRequest)
	oldCookie := onlySessionCookie(t, anotherAnonymous)
	var oldActor meResponse
	if err := json.Unmarshal(anotherAnonymous.Body.Bytes(), &oldActor); err != nil || oldActor.Actor == nil {
		t.Fatal("could not read anonymous identity")
	}
	store.credentials["existing@example.com"] = auth.Credential{
		Actor:        auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000099", Kind: auth.UserKindRegistered},
		PasswordHash: "test-hash:existing password",
	}
	login := credentialRequest(t, router, "/api/v1/auth/login", "https://closer.example", oldCookie.Value, `{"email":"EXISTING@example.com","password":"existing password"}`)
	if login.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
	}
	loginCookie := onlySessionCookie(t, login)
	if loginCookie.Value == oldCookie.Value {
		t.Fatal("login did not rotate the browser session token")
	}
	var loggedIn meResponse
	if err := json.Unmarshal(login.Body.Bytes(), &loggedIn); err != nil || loggedIn.Actor == nil || loggedIn.Actor.AuthUserID != "00000000-0000-4000-8000-000000000099" {
		t.Fatalf("login projection=%+v error=%v", loggedIn, err)
	}
	if !store.revoked || store.userKinds[oldActor.Actor.AuthUserID] != auth.UserKindAnonymous {
		t.Fatalf("login merged the anonymous identity or left its session active: revoked=%t kind=%q", store.revoked, store.userKinds[oldActor.Actor.AuthUserID])
	}

	logoutAll := credentialRequest(t, router, "/api/v1/auth/logout-all", "https://closer.example", loginCookie.Value, "")
	if logoutAll.Code != http.StatusOK || !store.allSessionsRevoked {
		t.Fatalf("logout-all status=%d revoked=%t body=%s", logoutAll.Code, store.allSessionsRevoked, logoutAll.Body.String())
	}
	if cookie := onlySessionCookie(t, logoutAll); cookie.MaxAge >= 0 {
		t.Fatalf("logout-all did not expire cookie: %+v", cookie)
	}
}

func TestLoginErrorsAreGenericAndRateLimitProvidesRetryAfter(t *testing.T) {
	store := newRouteCredentialStore()
	store.credentials["known@example.com"] = auth.Credential{
		Actor:        auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000098", Kind: auth.UserKindRegistered},
		PasswordHash: "test-hash:correct password",
	}
	service := auth.NewServiceWithCredentials(store, store, routePasswordHasher{})
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	unknown := credentialRequest(t, router, "/api/v1/auth/login", "https://closer.example", "", `{"email":"missing@example.com","password":"wrong password"}`)
	wrong := credentialRequest(t, router, "/api/v1/auth/login", "https://closer.example", "", `{"email":"known@example.com","password":"wrong password"}`)
	var unknownBody, wrongBody apiErrorBody
	if err := json.Unmarshal(unknown.Body.Bytes(), &unknownBody); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(wrong.Body.Bytes(), &wrongBody); err != nil {
		t.Fatal(err)
	}
	if unknown.Code != http.StatusUnauthorized || wrong.Code != http.StatusUnauthorized || unknownBody.Error.Code != "INVALID_CREDENTIALS" || unknownBody.Error.Code != wrongBody.Error.Code || unknownBody.Error.Message != wrongBody.Error.Message {
		t.Fatalf("enumerable login failures: missing=%d %+v wrong=%d %+v", unknown.Code, unknownBody, wrong.Code, wrongBody)
	}

	limitedStore := newRouteCredentialStore()
	limitedStore.rateLimit = auth.LoginRateResult{Limited: true, RetryAfter: 27 * time.Second}
	limitedRouter := NewRouterWithAuth(nil, nil, auth.NewServiceWithCredentials(limitedStore, limitedStore, routePasswordHasher{}), SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	limited := credentialRequest(t, limitedRouter, "/api/v1/auth/login", "https://closer.example", "", `{"email":"any@example.com","password":"any password"}`)
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "27" {
		t.Fatalf("rate limit status=%d Retry-After=%q body=%s", limited.Code, limited.Header().Get("Retry-After"), limited.Body.String())
	}
}

func TestCredentialMutationsRequireConfiguredOriginAndStrictJson(t *testing.T) {
	store := newRouteCredentialStore()
	router := NewRouterWithAuth(nil, nil, auth.NewServiceWithCredentials(store, store, routePasswordHasher{}), SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	for _, test := range []struct {
		origin, body string
		want         int
	}{
		{"https://evil.example", `{"email":"user@example.com","password":"correct horse"}`, http.StatusForbidden},
		{"https://closer.example", `{"email":"user@example.com","password":"correct horse","actorId":"attacker"}`, http.StatusBadRequest},
	} {
		response := credentialRequest(t, router, "/api/v1/auth/register", test.origin, "", test.body)
		if response.Code != test.want || store.registrationCount != 0 {
			t.Fatalf("origin/body check status=%d registrations=%d body=%s", response.Code, store.registrationCount, response.Body.String())
		}
	}
	anonymousResponse := httptest.NewRecorder()
	anonymousRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/anonymous", nil)
	anonymousRequest.Header.Set("Origin", "https://closer.example")
	router.ServeHTTP(anonymousResponse, anonymousRequest)
	if anonymousResponse.Code != http.StatusCreated {
		t.Fatalf("anonymous setup status=%d", anonymousResponse.Code)
	}
	anonymousCookie := onlySessionCookie(t, anonymousResponse)
	response := credentialRequest(t, router, "/api/v1/auth/register", "https://closer.example", anonymousCookie.Value, `{"email":"user@example.com","password":"correct horse"}`)
	if response.Code != http.StatusConflict || store.registrationCount != 0 {
		t.Fatalf("authenticated anonymous direct register status=%d registrations=%d body=%s", response.Code, store.registrationCount, response.Body.String())
	}
}

func TestAdminLoginAndLogoutRequireTrustedOriginAndAdminMembership(t *testing.T) {
	store := newRouteCredentialStore()
	admin := auth.Credential{
		Actor:        auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000201", Kind: auth.UserKindAdmin},
		PasswordHash: "test-hash:correct password",
	}
	consumer := auth.Credential{
		Actor:        auth.Actor{AuthUserID: "00000000-0000-4000-8000-000000000202", Kind: auth.UserKindRegistered},
		PasswordHash: "test-hash:correct password",
	}
	store.credentials["admin@example.com"] = admin
	store.credentials["consumer@example.com"] = consumer
	store.userKinds[admin.Actor.AuthUserID] = auth.UserKindAdmin
	store.userKinds[consumer.Actor.AuthUserID] = auth.UserKindRegistered
	service := auth.NewServiceWithCredentials(store, store, routePasswordHasher{})
	router := NewRouterWithAuth(nil, nil, service, SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})

	foreign := credentialRequest(t, router, "/api/v1/admin/login", "https://evil.example", "", `{"email":"admin@example.com","password":"correct password"}`)
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("foreign-origin Admin login status=%d body=%s", foreign.Code, foreign.Body.String())
	}

	consumerLogin := credentialRequest(t, router, "/api/v1/admin/login", "https://closer.example", "", `{"email":"consumer@example.com","password":"correct password"}`)
	var consumerBody apiErrorBody
	if err := json.Unmarshal(consumerLogin.Body.Bytes(), &consumerBody); err != nil {
		t.Fatal(err)
	}
	if consumerLogin.Code != http.StatusUnauthorized || consumerBody.Error.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("consumer Admin-login response status=%d body=%s", consumerLogin.Code, consumerLogin.Body.String())
	}

	login := credentialRequest(t, router, "/api/v1/admin/login", "https://closer.example", "", `{"email":"admin@example.com","password":"correct password"}`)
	if login.Code != http.StatusOK || login.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("Admin login status=%d cache=%q body=%s", login.Code, login.Header().Get("Cache-Control"), login.Body.String())
	}
	cookie := onlySessionCookie(t, login)
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatalf("Admin session cookie attributes = %+v", cookie)
	}
	if actor, err := service.RequireAdminSession(context.Background(), cookie.Value); err != nil || actor.AuthUserID != admin.Actor.AuthUserID {
		t.Fatalf("RequireAdminSession() actor=%+v error=%v", actor, err)
	}

	foreignLogout := credentialRequest(t, router, "/api/v1/admin/logout", "https://evil.example", cookie.Value, "")
	if foreignLogout.Code != http.StatusForbidden {
		t.Fatalf("foreign-origin Admin logout status=%d body=%s", foreignLogout.Code, foreignLogout.Body.String())
	}
	if _, err := service.RequireAdminSession(context.Background(), cookie.Value); err != nil {
		t.Fatalf("foreign Origin revoked Admin session: %v", err)
	}
	missingLogout := credentialRequest(t, router, "/api/v1/admin/logout", "https://closer.example", "", "")
	if missingLogout.Code != http.StatusUnauthorized {
		t.Fatalf("Admin logout without a session status=%d body=%s", missingLogout.Code, missingLogout.Body.String())
	}

	consumerStore := newRouteCredentialStore()
	consumerService := auth.NewServiceWithCredentials(consumerStore, consumerStore, routePasswordHasher{})
	consumerSession, err := consumerService.Register(context.Background(), "consumer@example.net", "correct password")
	if err != nil {
		t.Fatalf("create registered session for Admin authorization check: %v", err)
	}
	consumerRouter := NewRouterWithAuth(nil, nil, consumerService, SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	consumerLogout := credentialRequest(t, consumerRouter, "/api/v1/admin/logout", "https://closer.example", consumerSession.Token, "")
	if consumerLogout.Code != http.StatusUnauthorized {
		t.Fatalf("consumer session accessed Admin logout status=%d body=%s", consumerLogout.Code, consumerLogout.Body.String())
	}

	logout := credentialRequest(t, router, "/api/v1/admin/logout", "https://closer.example", cookie.Value, "")
	if logout.Code != http.StatusOK || onlySessionCookie(t, logout).MaxAge >= 0 {
		t.Fatalf("Admin logout status=%d cookie=%+v body=%s", logout.Code, onlySessionCookie(t, logout), logout.Body.String())
	}
	if _, err := service.RequireAdminSession(context.Background(), cookie.Value); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("Admin session after logout error=%v, want unauthenticated", err)
	}
}

func TestAdminLoginRateLimitIncludesRetryAfter(t *testing.T) {
	store := newRouteCredentialStore()
	store.adminRateLimit = auth.LoginRateResult{Limited: true, RetryAfter: 18 * time.Second}
	router := NewRouterWithAuth(nil, nil, auth.NewServiceWithCredentials(store, store, routePasswordHasher{}), SecurityConfig{TrustedOrigins: []string{"https://closer.example"}})
	response := credentialRequest(t, router, "/api/v1/admin/login", "https://closer.example", "", `{"email":"admin@example.com","password":"correct password"}`)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "18" {
		t.Fatalf("Admin rate limit status=%d Retry-After=%q body=%s", response.Code, response.Header().Get("Retry-After"), response.Body.String())
	}
}

func TestRequestClientIPIgnoresUntrustedForwardedHeaders(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.RemoteAddr = "198.51.100.9:4567"
	request.Header.Set("X-Forwarded-For", "203.0.113.7")
	if got := requestClientIP(request, []string{"10.0.0.0/8"}); got != "198.51.100.9" {
		t.Fatalf("untrusted peer client IP = %q, want direct peer", got)
	}

	request.RemoteAddr = "10.2.0.9:4567"
	request.Header.Set("X-Forwarded-For", "203.0.113.7, 10.1.0.4")
	if got := requestClientIP(request, []string{"10.0.0.0/8"}); got != "203.0.113.7" {
		t.Fatalf("trusted proxy client IP = %q, want leftmost untrusted hop", got)
	}

	request.Header.Set("X-Forwarded-For", "203.0.113.7, not-an-ip")
	if got := requestClientIP(request, []string{"10.0.0.0/8"}); got != "10.2.0.9" {
		t.Fatalf("malformed proxy chain client IP = %q, want proxy peer", got)
	}
}

func credentialRequest(t *testing.T, router http.Handler, path, origin, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var requestBody *strings.Reader
	if body == "" {
		requestBody = strings.NewReader("")
	} else {
		requestBody = strings.NewReader(body)
	}
	request := httptest.NewRequest(http.MethodPost, path, requestBody)
	request.Header.Set("Origin", origin)
	if token != "" {
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

type routeCredentialStore struct {
	*routeSessionStore
	credentials        map[string]auth.Credential
	userKinds          map[string]auth.UserKind
	registeredEmail    string
	registrationCount  int
	upgradeCount       int
	activeSession      bool
	rateLimit          auth.LoginRateResult
	adminRateLimit     auth.LoginRateResult
	allSessionsRevoked bool
}

func newRouteCredentialStore() *routeCredentialStore {
	return &routeCredentialStore{
		routeSessionStore: &routeSessionStore{},
		credentials:       make(map[string]auth.Credential),
		userKinds:         make(map[string]auth.UserKind),
	}
}

func (store *routeCredentialStore) CreateAnonymous(ctx context.Context, userID, sessionID string, tokenHash []byte, createdAt, expiresAt time.Time) error {
	if store.userKinds == nil {
		store.userKinds = make(map[string]auth.UserKind)
	}
	store.userKinds[userID] = auth.UserKindAnonymous
	err := store.routeSessionStore.CreateAnonymous(ctx, userID, sessionID, tokenHash, createdAt, expiresAt)
	store.activeSession = err == nil
	return err
}

func (store *routeCredentialStore) Register(_ context.Context, userID, sessionID, email, passwordHash string, tokenHash []byte, createdAt, expiresAt time.Time) error {
	if _, exists := store.credentials[email]; exists {
		return auth.ErrEmailInUse
	}
	store.registrationCount++
	store.registeredEmail = email
	actor := auth.Actor{AuthUserID: userID, Kind: auth.UserKindRegistered}
	store.credentials[email] = auth.Credential{Actor: actor, PasswordHash: passwordHash}
	store.userKinds[userID] = auth.UserKindRegistered
	store.userID = userID
	store.sessionID = sessionID
	store.tokenHash = append([]byte(nil), tokenHash...)
	store.state = auth.SessionState{Actor: actor, SessionID: sessionID, CreatedAt: createdAt, ExpiresAt: expiresAt, LastUsedAt: createdAt}
	store.activeSession = true
	return nil
}

func (store *routeCredentialStore) FindSession(_ context.Context, tokenHash []byte, now time.Time) (auth.SessionState, error) {
	if !store.activeSession || !bytes.Equal(store.tokenHash, tokenHash) || !store.state.ExpiresAt.After(now) {
		return auth.SessionState{}, auth.ErrUnauthenticated
	}
	return store.state, nil
}

func (store *routeCredentialStore) RevokeSession(_ context.Context, tokenHash []byte, _ time.Time) error {
	if bytes.Equal(store.tokenHash, tokenHash) {
		store.activeSession = false
	}
	return nil
}

func (store *routeCredentialStore) Upgrade(_ context.Context, userID, email, passwordHash string, _ time.Time) error {
	if _, exists := store.credentials[email]; exists {
		return auth.ErrEmailInUse
	}
	if store.state.Actor.AuthUserID != userID || store.state.Actor.Kind != auth.UserKindAnonymous {
		return auth.ErrCannotUpgrade
	}
	actor := auth.Actor{AuthUserID: userID, Kind: auth.UserKindRegistered}
	store.credentials[email] = auth.Credential{Actor: actor, PasswordHash: passwordHash}
	store.userKinds[userID] = auth.UserKindRegistered
	store.state.Actor = actor
	store.upgradeCount++
	return nil
}

func (store *routeCredentialStore) FindCredential(_ context.Context, email string) (auth.Credential, error) {
	credential, found := store.credentials[email]
	if !found {
		return auth.Credential{}, auth.ErrCredentialNotFound
	}
	return credential, nil
}

func (store *routeCredentialStore) CreateLoginSession(_ context.Context, userID, sessionID string, tokenHash, previousTokenHash []byte, _ string, now, expiresAt time.Time) error {
	if len(previousTokenHash) > 0 && bytes.Equal(previousTokenHash, store.tokenHash) {
		store.revoked = true
	}
	var actor auth.Actor
	for _, credential := range store.credentials {
		if credential.Actor.AuthUserID == userID {
			actor = credential.Actor
			break
		}
	}
	if actor.AuthUserID == "" {
		return auth.ErrInvalidCredentials
	}
	store.userID = userID
	store.sessionID = sessionID
	store.tokenHash = append([]byte(nil), tokenHash...)
	store.state = auth.SessionState{Actor: actor, SessionID: sessionID, CreatedAt: now, ExpiresAt: expiresAt, LastUsedAt: now}
	store.activeSession = true
	return nil
}

func (store *routeCredentialStore) RevokeAllSessions(_ context.Context, _ string, _ time.Time) error {
	store.allSessionsRevoked = true
	store.activeSession = false
	return nil
}

func (store *routeCredentialStore) CountConsumerLoginAttempt(_ context.Context, _, _ string) (auth.LoginRateResult, error) {
	return store.rateLimit, nil
}

func (store *routeCredentialStore) DeleteOldRateLimits(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func (store *routeCredentialStore) BootstrapAdmin(_ context.Context, userID, email, passwordHash string, _ time.Time) (string, bool, error) {
	if existing, ok := store.credentials[email]; ok {
		if existing.Actor.Kind != auth.UserKindAdmin {
			return "", false, auth.ErrAdminEmailInUse
		}
		return existing.Actor.AuthUserID, false, nil
	}
	actor := auth.Actor{AuthUserID: userID, Kind: auth.UserKindAdmin}
	store.credentials[email] = auth.Credential{Actor: actor, PasswordHash: passwordHash}
	store.userKinds[userID] = auth.UserKindAdmin
	return userID, true, nil
}

func (store *routeCredentialStore) FindAdminCredential(_ context.Context, email string) (auth.Credential, error) {
	credential, ok := store.credentials[email]
	if !ok || credential.Actor.Kind != auth.UserKindAdmin {
		return auth.Credential{}, auth.ErrCredentialNotFound
	}
	return credential, nil
}

func (store *routeCredentialStore) CreateAdminLoginSession(ctx context.Context, userID, sessionID string, tokenHash, previousTokenHash []byte, passwordHash string, now, expiresAt time.Time) error {
	return store.CreateLoginSession(ctx, userID, sessionID, tokenHash, previousTokenHash, passwordHash, now, expiresAt)
}

func (store *routeCredentialStore) RecoverAdmin(_ context.Context, email, passwordHash string, _ time.Time) (string, int64, error) {
	credential, ok := store.credentials[email]
	if !ok || credential.Actor.Kind != auth.UserKindAdmin {
		return "", 0, auth.ErrAdminNotFound
	}
	credential.PasswordHash = passwordHash
	store.credentials[email] = credential
	store.activeSession = false
	return credential.Actor.AuthUserID, 1, nil
}

func (store *routeCredentialStore) IsAdmin(_ context.Context, userID string) (bool, error) {
	return store.userKinds[userID] == auth.UserKindAdmin, nil
}

func (store *routeCredentialStore) CountAdminLoginAttempt(context.Context, string) (auth.LoginRateResult, error) {
	return store.adminRateLimit, nil
}

type routePasswordHasher struct{}

func (routePasswordHasher) Hash(_ context.Context, password string) (string, error) {
	if len(password) < auth.MinPasswordBytes || len(password) > auth.MaxPasswordBytes {
		return "", auth.ErrInvalidInput
	}
	return "test-hash:" + password, nil
}

func (routePasswordHasher) Verify(_ context.Context, encoded, password string) (bool, error) {
	return encoded == "test-hash:"+password, nil
}

func (routePasswordHasher) NeedsRehash(string) bool { return false }
