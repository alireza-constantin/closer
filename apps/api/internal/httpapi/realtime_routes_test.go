package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/pair"
	"github.com/alireza-constantin/closer/apps/api/internal/participant"

	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

func TestWriteRealtimeEventUsesNamedMetadataOnlySSE(t *testing.T) {
	var output bytes.Buffer
	writer := bufio.NewWriter(&output)
	writeRealtimeEvent(writer, realtime.Event{
		Version: realtime.Version, PairID: "pair-id", Type: realtime.PairTerminated,
	})
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	want := "event: pair.terminated\ndata: {\"version\":1,\"pairId\":\"pair-id\",\"type\":\"pair.terminated\"}\n\n"
	if output.String() != want {
		t.Fatalf("SSE event = %q, want %q", output.String(), want)
	}
}

func TestRealtimeClosesAfterSubscriberLosesActiveMembership(t *testing.T) {
	ctx := context.Background()
	sessionStore := &routeSessionStore{}
	authService := auth.NewServiceWithClock(sessionStore, nil)
	created, err := authService.CreateAnonymous(ctx)
	if err != nil {
		t.Fatal(err)
	}
	participantID := "participant-1"
	participantService := participant.NewService(realtimeParticipantStore{
		participant: participant.Participant{ID: participantID, AuthUserID: created.Actor.AuthUserID, DisplayName: "Former member"},
	})
	accessStore := &realtimePairAccessStore{active: true}
	pairService := pair.NewService(accessStore)
	registry := realtime.NewRegistry(4)
	router := NewRouterWithServicesAndRealtime(nil, nil, authService, participantService, pairService, nil, registry, SecurityConfig{})

	requestCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/pairs/pair-1/events", nil).WithContext(requestCtx)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: created.Token})
	writer := newSSETestWriter()
	done := make(chan struct{})
	go func() {
		defer close(done)
		router.ServeHTTP(writer, request)
	}()

	select {
	case <-writer.flushed:
	case <-time.After(time.Second):
		t.Fatal("SSE connection did not become active")
	}

	accessStore.setActive(false)
	registry.Publish(realtime.Event{Version: realtime.Version, PairID: "pair-1", Type: realtime.PairChanged})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("SSE connection stayed open after membership ended")
	}
	if body := writer.bodyString(); strings.Contains(body, string(realtime.PairChanged)) {
		t.Fatalf("former member received post-replacement event: %q", body)
	}
}

type realtimePairAccessStore struct {
	mu     sync.Mutex
	active bool
}

func (s *realtimePairAccessStore) WithinTx(context.Context, func(pair.Tx) error) error {
	return errors.New("unexpected transaction")
}
func (s *realtimePairAccessStore) ListSpaces(context.Context, string) ([]pair.Space, error) {
	return nil, nil
}
func (s *realtimePairAccessStore) GetActivePairAccess(context.Context, string, string) (pair.Access, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.active {
		return pair.Access{}, pair.ErrPairNotFound
	}
	return pair.Access{PairID: "pair-1", MembershipID: "membership-1", ActorSlot: pair.SlotFirst}, nil
}
func (s *realtimePairAccessStore) ListActiveMembers(context.Context, string) ([]pair.Member, error) {
	return nil, nil
}
func (s *realtimePairAccessStore) FindFormerTerminatedPair(context.Context, string, string) (string, error) {
	return "", pair.ErrPairNotFound
}
func (s *realtimePairAccessStore) setActive(active bool) {
	s.mu.Lock()
	s.active = active
	s.mu.Unlock()
}

type realtimeParticipantStore struct{ participant participant.Participant }

func (s realtimeParticipantStore) WithinTx(context.Context, func(participant.Tx) error) error {
	return errors.New("unexpected transaction")
}
func (s realtimeParticipantStore) GetByAuthUserID(_ context.Context, authUserID string) (participant.Participant, error) {
	if s.participant.AuthUserID != authUserID {
		return participant.Participant{}, participant.ErrNotFound
	}
	return s.participant, nil
}

type sseTestWriter struct {
	mu      sync.Mutex
	header  http.Header
	status  int
	body    bytes.Buffer
	flushed chan struct{}
}

func newSSETestWriter() *sseTestWriter {
	return &sseTestWriter{header: make(http.Header), flushed: make(chan struct{}, 8)}
}
func (w *sseTestWriter) Header() http.Header { return w.header }
func (w *sseTestWriter) WriteHeader(status int) {
	w.mu.Lock()
	w.status = status
	w.mu.Unlock()
}
func (w *sseTestWriter) Write(value []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.Write(value)
}
func (w *sseTestWriter) Flush() {
	select {
	case w.flushed <- struct{}{}:
	default:
	}
}
func (w *sseTestWriter) bodyString() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.String()
}
