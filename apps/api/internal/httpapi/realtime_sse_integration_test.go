package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

const sseTestTimeout = 5 * time.Second

type liveSSEFixture struct {
	t           *testing.T
	pool        *postgres.Pool
	authService *auth.Service
	router      http.Handler
	registry    *realtime.Registry
	publisher   *postgres.RealtimePublisher
	server      *httptest.Server
	participant []string
	authUsers   []string
	pairs       []string
	streams     []*liveSSEStream
}

type liveSSEEvent struct {
	Name string
	Data string
}

type liveSSEEnd struct {
	raw string
	err error
}

type liveSSEStream struct {
	response *http.Response
	cancel   context.CancelFunc
	events   chan liveSSEEvent
	done     chan struct{}
	mu       sync.Mutex
	end      liveSSEEnd
}

func newLiveSSEFixture(t *testing.T) *liveSSEFixture {
	t.Helper()
	pool := openParticipantPairTestPool(t)
	authStore := postgresauth.NewStore(pool)
	authService := auth.NewServiceWithCredentials(authStore, authStore, nil)
	participantService := participant.NewService(postgresparticipant.NewStore(pool))
	registry := realtime.NewRegistry(32)
	publisher := postgres.NewRealtimePublisher(pool)
	pairService := pair.NewService(postgrespair.NewStore(pool))
	inviteService := invite.NewService(postgresinvite.NewStore(pool))
	router := NewRouterWithServicesAndRealtime(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		pool,
		authService,
		participantService,
		pairService,
		inviteService,
		registry,
		SecurityConfig{TrustedOrigins: []string{domainTestOrigin}},
	)
	fixture := &liveSSEFixture{
		t: t, pool: pool, authService: authService, router: router,
		registry: registry, publisher: publisher,
	}
	fixture.server = httptest.NewServer(router)
	t.Cleanup(func() { fixture.cleanupDatabase() })
	t.Cleanup(func() { fixture.close() })
	return fixture
}

func (f *liveSSEFixture) close() {
	for _, stream := range f.streams {
		stream.close()
	}
	if f.server != nil {
		f.server.Close()
	}
	f.registry.Close()
}

func (f *liveSSEFixture) cleanupDatabase() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, pairID := range f.pairs {
		_ = f.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, "DELETE FROM pair WHERE id=$1", pairID)
			return err
		})
	}
	for _, participantID := range f.participant {
		_ = f.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, "DELETE FROM participant WHERE id=$1", participantID)
			return err
		})
	}
	for _, authUserID := range f.authUsers {
		_ = f.pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, "DELETE FROM auth_user WHERE id=$1", authUserID)
			return err
		})
	}
}

func (f *liveSSEFixture) actor(name string) testHTTPActor {
	f.t.Helper()
	actor := createOnboardedTestActor(f.t, f.router, name)
	var authUserID string
	if err := f.pool.WithConnection(context.Background(), func(db postgres.QueryDB) error {
		return db.QueryRow(context.Background(), "SELECT auth_user_id::text FROM participant WHERE id=$1", actor.participantID).Scan(&authUserID)
	}); err != nil {
		f.t.Fatal(err)
	}
	f.participant = append(f.participant, actor.participantID)
	f.authUsers = append(f.authUsers, authUserID)
	return actor
}

func (f *liveSSEFixture) anonymousCookie() *http.Cookie {
	f.t.Helper()
	cookie := createAnonymousTestCookie(f.t, f.router)
	response := performDomainRequest(f.router, http.MethodGet, "/api/v1/me", nil, cookie)
	var me meResponse
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &me) != nil || me.Actor == nil {
		f.t.Fatal("anonymous test identity could not be resolved")
	}
	f.authUsers = append(f.authUsers, me.Actor.AuthUserID)
	return cookie
}

func (f *liveSSEFixture) pair(first, second testHTTPActor, intendedName string) (string, string) {
	f.t.Helper()
	created := performDomainRequest(f.router, http.MethodPost, "/api/v1/pairs", map[string]string{
		"intendedPersonName": intendedName, "relationshipType": "friend",
	}, first.cookie)
	var pairResult createPairResponse
	if created.Code != http.StatusOK || json.Unmarshal(created.Body.Bytes(), &pairResult) != nil || pairResult.PairID == "" {
		f.t.Fatalf("Pair setup failed with status %d", created.Code)
	}
	issued := performDomainRequest(f.router, http.MethodPost, "/api/v1/pairs/"+pairResult.PairID+"/invite", nil, first.cookie)
	var invitation inviteStateResponse
	if issued.Code != http.StatusCreated || json.Unmarshal(issued.Body.Bytes(), &invitation) != nil || invitation.Token == "" {
		f.t.Fatalf("invite setup failed with status %d", issued.Code)
	}
	claimed := performDomainRequest(f.router, http.MethodPost, "/api/v1/invites/"+invitation.Token+"/redeem", nil, second.cookie)
	if claimed.Code != http.StatusOK {
		f.t.Fatalf("Pair claim setup failed with status %d", claimed.Code)
	}
	f.pairs = append(f.pairs, pairResult.PairID)
	return pairResult.PairID, invitation.Token
}

func (f *liveSSEFixture) open(pairID string, actor testHTTPActor) *liveSSEStream {
	f.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, f.server.URL+"/api/v1/pairs/"+pairID+"/events", nil)
	if err != nil {
		cancel()
		f.t.Fatal("could not create SSE request")
	}
	request.AddCookie(actor.cookie)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		f.t.Fatalf("SSE request failed: %v", err)
	}
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
		_ = response.Body.Close()
		cancel()
		f.t.Fatalf("authorized SSE response had status %d or wrong content type", response.StatusCode)
	}
	stream := &liveSSEStream{
		response: response, cancel: cancel,
		events: make(chan liveSSEEvent, 16), done: make(chan struct{}),
	}
	f.streams = append(f.streams, stream)
	go stream.read()
	return stream
}

func (f *liveSSEFixture) denied(pairID string, actor testHTTPActor, wantStatus int) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), sseTestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, f.server.URL+"/api/v1/pairs/"+pairID+"/events", nil)
	if err != nil {
		f.t.Fatal("could not create denied SSE request")
	}
	request.AddCookie(actor.cookie)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		f.t.Fatalf("denied SSE request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus || response.Header.Get("Content-Type") == "text/event-stream" {
		f.t.Fatalf("denied SSE request returned status %d; expected %d without a stream", response.StatusCode, wantStatus)
	}
}

func (f *liveSSEFixture) publish(event realtime.Event) {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), sseTestTimeout)
	defer cancel()
	if err := f.publisher.Publish(ctx, event); err != nil {
		f.t.Fatalf("could not publish test event: %v", err)
	}
}

func (s *liveSSEStream) read() {
	defer close(s.done)
	defer s.response.Body.Close()
	scanner := bufio.NewScanner(s.response.Body)
	var current liveSSEEvent
	var raw strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		raw.WriteString(line)
		raw.WriteByte('\n')
		switch {
		case strings.HasPrefix(line, "event: "):
			current.Name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			current.Data = strings.TrimPrefix(line, "data: ")
		case line == "" && current.Data != "":
			select {
			case s.events <- current:
			case <-s.response.Request.Context().Done():
				s.setEnd(raw.String(), s.response.Request.Context().Err())
				return
			}
			current = liveSSEEvent{}
		}
	}
	s.setEnd(raw.String(), scanner.Err())
}

func (s *liveSSEStream) setEnd(raw string, err error) {
	s.mu.Lock()
	s.end = liveSSEEnd{raw: raw, err: err}
	s.mu.Unlock()
}

func (s *liveSSEStream) next(t *testing.T) liveSSEEvent {
	t.Helper()
	select {
	case event := <-s.events:
		return event
	default:
	}
	select {
	case event := <-s.events:
		return event
	case <-s.done:
		select {
		case event := <-s.events:
			return event
		default:
		}
		t.Fatal("SSE stream closed before the expected event")
	case <-time.After(sseTestTimeout):
		t.Fatal("timed out waiting for SSE event")
	}
	return liveSSEEvent{}
}

func (s *liveSSEStream) waitClosed(t *testing.T) liveSSEEnd {
	t.Helper()
	select {
	case <-s.done:
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.end
	case <-time.After(sseTestTimeout):
		t.Fatal("SSE stream did not close within the bounded timeout")
	}
	return liveSSEEnd{}
}

func (s *liveSSEStream) close() {
	s.cancel()
	_ = s.response.Body.Close()
	select {
	case <-s.done:
	case <-time.After(sseTestTimeout):
	}
}

func assertMetadataEvent(t *testing.T, event liveSSEEvent, pairID string, eventType realtime.EventType, forbidden ...string) {
	t.Helper()
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(event.Data), &fields) != nil || len(fields) != 3 {
		t.Fatal("SSE data was not the three-field metadata contract")
	}
	var decoded realtime.Event
	if json.Unmarshal([]byte(event.Data), &decoded) != nil || !decoded.Valid() || decoded.PairID != pairID || decoded.Type != eventType || event.Name != string(eventType) {
		t.Fatal("SSE metadata did not match the expected Pair event")
	}
	for _, key := range []string{"version", "pairId", "type"} {
		if _, ok := fields[key]; !ok {
			t.Fatal("SSE metadata omitted a required contract field")
		}
	}
	for _, secret := range forbidden {
		if secret != "" && strings.Contains(event.Data, secret) {
			t.Fatal("SSE metadata contained sensitive or unrelated content")
		}
	}
}

func TestRealtimeSSEPostgresAuthorizationFanoutAndRollback(t *testing.T) {
	f := newLiveSSEFixture(t)
	a := f.actor("SSE P1 A")
	b := f.actor("SSE P1 B")
	c := f.actor("SSE P2 C")
	d := f.actor("SSE P2 D")
	outsider := f.actor("SSE outsider")
	p1, p1Invite := f.pair(a, b, "P1 intended secret")
	p2, p2Invite := f.pair(c, d, "P2 intended secret")
	listenerCtx, stopListener := context.WithCancel(context.Background())
	listenerURL, appName := realtimeListenerURL(t)
	listener := postgres.NewRealtimeListener(listenerURL, f.registry, slog.New(slog.NewTextHandler(io.Discard, nil)))
	listenerDone := make(chan error, 1)
	go func() { listenerDone <- listener.Run(listenerCtx) }()
	waitForRealtimeListener(t, f.pool, appName, true)
	t.Cleanup(func() {
		stopListener()
		select {
		case <-listenerDone:
		case <-time.After(sseTestTimeout):
			t.Error("PostgreSQL realtime listener did not stop")
		}
	})

	f.denied(p1, outsider, http.StatusNotFound)
	f.denied(p1, c, http.StatusNotFound)
	streamP1 := f.open(p1, a)
	streamP2 := f.open(p2, c)
	if streamP1.response.StatusCode != http.StatusOK || streamP2.response.StatusCode != http.StatusOK {
		t.Fatal("authorized member streams did not remain open")
	}

	forbidden := []string{
		"FIRST-ANSWER-SENTINEL", "PRIVATE-REPLY-SENTINEL", "QUESTION-WORDING-SENTINEL",
		"CANDIDATE-WORDING-SENTINEL", "REACTION-CONTENT-SENTINEL",
		a.cookie.Value, b.cookie.Value, c.cookie.Value, d.cookie.Value, outsider.cookie.Value,
		p1Invite, p2Invite,
	}

	// A malformed PostgreSQL notification must be ignored while the real
	// listener remains available for the following valid notification.
	ctx, cancel := context.WithTimeout(context.Background(), sseTestTimeout)
	err := f.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		_, err := db.Exec(ctx, "SELECT pg_notify($1, $2)", postgres.RealtimeChannel, "{malformed-notify")
		return err
	})
	cancel()
	if err != nil {
		t.Fatal("could not send malformed-notification test payload")
	}

	rollbackEvent := realtime.Event{Version: realtime.Version, PairID: p1, Type: realtime.PairTerminated}
	rollbackErr := errors.New("intentional transaction rollback")
	ctx, cancel = context.WithTimeout(context.Background(), sseTestTimeout)
	err = f.pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		if err := postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, rollbackEvent); err != nil {
			return err
		}
		return rollbackErr
	})
	cancel()
	if !errors.Is(err, rollbackErr) {
		t.Fatal("test transaction did not roll back as intended")
	}

	// Reverse the order as well so a cross-Pair leak becomes the first event
	// observed by the other Pair's stream and fails deterministically.
	f.publish(realtime.Event{Version: realtime.Version, PairID: p1, Type: realtime.PairChanged})
	assertMetadataEvent(t, streamP1.next(t), p1, realtime.PairChanged, forbidden...)
	f.publish(realtime.Event{Version: realtime.Version, PairID: p2, Type: realtime.PrivateChanged})
	assertMetadataEvent(t, streamP2.next(t), p2, realtime.PrivateChanged, forbidden...)
	f.publish(realtime.Event{Version: realtime.Version, PairID: p1, Type: realtime.TogetherChanged})
	assertMetadataEvent(t, streamP1.next(t), p1, realtime.TogetherChanged, forbidden...)

	streamP1.close()
	streamP2.close()
	fresh := f.open(p1, a)
	f.publish(realtime.Event{Version: realtime.Version, PairID: p1, Type: realtime.PairChanged})
	assertMetadataEvent(t, fresh.next(t), p1, realtime.PairChanged, forbidden...)
	if err := f.pool.Ping(context.Background()); err != nil {
		t.Fatal("database pool was unhealthy after SSE resource cleanup")
	}
}

func TestRealtimeSSEPostgresRejoinReplacementAndTermination(t *testing.T) {
	f := newLiveSSEFixture(t)
	creator := f.actor("SSE pair creator")
	former := f.actor("SSE former member")
	pairID, inviteToken := f.pair(creator, former, "Replacement intended secret")
	listenerCtx, stopListener := context.WithCancel(context.Background())
	listenerURL, appName := realtimeListenerURL(t)
	listener := postgres.NewRealtimeListener(listenerURL, f.registry, slog.New(slog.NewTextHandler(io.Discard, nil)))
	listenerDone := make(chan error, 1)
	go func() { listenerDone <- listener.Run(listenerCtx) }()
	waitForRealtimeListener(t, f.pool, appName, true)
	t.Cleanup(func() {
		stopListener()
		select {
		case <-listenerDone:
		case <-time.After(sseTestTimeout):
			t.Error("PostgreSQL realtime listener did not stop")
		}
	})
	formerStream := f.open(pairID, former)

	if err := f.authService.RevokeSession(context.Background(), former.cookie.Value); err != nil {
		t.Fatal("could not revoke former member session for canonical rejoin setup")
	}
	issued := performDomainRequest(f.router, http.MethodPost, "/api/v1/pairs/"+pairID+"/rejoin", nil, creator.cookie)
	var credential rejoinIssueResponse
	if issued.Code != http.StatusCreated || json.Unmarshal(issued.Body.Bytes(), &credential) != nil || credential.Token == "" {
		t.Fatalf("canonical rejoin issue failed with status %d", issued.Code)
	}
	replacementCookie := f.anonymousCookie()
	redeemed := performDomainRequest(f.router, http.MethodPost, "/api/v1/rejoin/"+credential.Token+"/redeem", map[string]string{
		"displayName": "Replacement Current Member",
	}, replacementCookie)
	var joined rejoinResponse
	if redeemed.Code != http.StatusOK || json.Unmarshal(redeemed.Body.Bytes(), &joined) != nil || joined.PairID != pairID {
		t.Fatalf("canonical rejoin redemption failed with status %d", redeemed.Code)
	}
	f.participant = append(f.participant, joined.ParticipantID)

	f.publish(realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairChanged})
	formerEnd := formerStream.waitClosed(t)
	if strings.Contains(formerEnd.raw, "data: ") || formerEnd.err != nil {
		t.Fatal("former member received data or an unexpected stream error after replacement")
	}
	f.denied(pairID, former, http.StatusUnauthorized)

	current := testHTTPActor{cookie: replacementCookie, participantID: joined.ParticipantID}
	currentStream := f.open(pairID, current)
	forbidden := []string{
		"FIRST-ANSWER-SENTINEL", "PRIVATE-REPLY-SENTINEL", "QUESTION-WORDING-SENTINEL",
		"CANDIDATE-WORDING-SENTINEL", "REACTION-CONTENT-SENTINEL",
		creator.cookie.Value, former.cookie.Value, replacementCookie.Value, inviteToken, credential.Token,
	}
	f.publish(realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairChanged})
	assertMetadataEvent(t, currentStream.next(t), pairID, realtime.PairChanged, forbidden...)
	select {
	case <-formerStream.done:
	default:
		t.Fatal("former member stream reopened after replacement member connected")
	}

	terminated := performDomainRequest(f.router, http.MethodPost, "/api/v1/pairs/"+pairID+"/terminate", nil, current.cookie)
	if terminated.Code != http.StatusOK {
		t.Fatalf("canonical Pair termination failed with status %d", terminated.Code)
	}
	terminal := currentStream.next(t)
	assertMetadataEvent(t, terminal, pairID, realtime.PairTerminated, forbidden...)
	currentEnd := currentStream.waitClosed(t)
	if currentEnd.err != nil {
		t.Fatal("replacement member stream ended with an unexpected error")
	}
	f.publish(realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairChanged})
	select {
	case _, open := <-currentStream.events:
		if open {
			t.Fatal("terminated Pair stream received an event after its terminal event")
		}
	default:
	}

	// The canonical route returns one terminal event for a former member of a
	// terminated Pair, then closes; it never establishes an active stream.
	reconnect := f.open(pairID, current)
	reconnectEvent := reconnect.next(t)
	assertMetadataEvent(t, reconnectEvent, pairID, realtime.PairTerminated, forbidden...)
	reconnectEnd := reconnect.waitClosed(t)
	if reconnectEnd.err != nil {
		t.Fatal("terminated-Pair one-shot response ended with an unexpected error")
	}
	if err := f.pool.Ping(context.Background()); err != nil {
		t.Fatal("database pool was unhealthy after replacement and termination SSE cases")
	}
}

func realtimeListenerURL(t *testing.T) (databaseURL, applicationName string) {
	t.Helper()
	databaseURL, err := testdb.LoadURL()
	if err != nil {
		t.Fatalf("load guarded PostgreSQL test URL: %v", err)
	}
	identifier, err := auth.NewID()
	if err != nil {
		t.Fatal("could not create listener test identifier")
	}
	applicationName = "closer-sse-" + identifier
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("could not parse guarded PostgreSQL test URL")
	}
	query := parsed.Query()
	query.Set("application_name", applicationName)
	parsed.RawQuery = query.Encode()
	return parsed.String(), applicationName
}

func waitForRealtimeListener(t *testing.T, pool *postgres.Pool, applicationName string, wantPresent bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), sseTestTimeout)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
			return db.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
				WHERE datname=current_database() AND usename=current_user AND application_name=$1`, applicationName).Scan(&count)
		})
		if err != nil {
			t.Fatal("could not observe PostgreSQL listener activity")
		}
		if (count == 1) == wantPresent {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("PostgreSQL listener did not reach the expected connection state")
		case <-ticker.C:
		}
	}
}

func TestRealtimeListenerRunStopsOnContextCancellation(t *testing.T) {
	pool := openParticipantPairTestPool(t)
	registry := realtime.NewRegistry(4)
	databaseURL, appName := realtimeListenerURL(t)
	ctx, cancel := context.WithCancel(context.Background())
	listener := postgres.NewRealtimeListener(databaseURL, registry, slog.New(slog.NewTextHandler(io.Discard, nil)))
	done := make(chan error, 1)
	go func() { done <- listener.Run(ctx) }()
	waitForRealtimeListener(t, pool, appName, true)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("listener returned an error after normal context cancellation")
		}
	case <-time.After(sseTestTimeout):
		t.Fatal("listener goroutine did not exit after context cancellation")
	}
	waitForRealtimeListener(t, pool, appName, false)

	subscription, err := registry.Subscribe("00000000-0000-4000-8000-000000000001")
	if err != nil {
		t.Fatal("registry did not remain usable after listener cancellation")
	}
	registry.Publish(realtime.Event{Version: realtime.Version, PairID: "00000000-0000-4000-8000-000000000001", Type: realtime.PairChanged})
	select {
	case event := <-subscription.Events:
		if event.Type != realtime.PairChanged {
			t.Fatal("registry published an unexpected post-cancellation event")
		}
	case <-time.After(sseTestTimeout):
		t.Fatal("registry remained unusable after listener cancellation")
	}
	subscription.Close()
	registry.Close()
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatal("PostgreSQL test pool was unhealthy after listener cancellation")
	}
}
