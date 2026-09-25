package postgres_test

import (
	"context"
	"io"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
)

func TestRealtimeListenerRunStopsOnContextCancellation(t *testing.T) {
	urlValue, err := testdb.LoadURL()
	if err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to run PostgreSQL realtime listener checks")
		}
		t.Fatalf("load guarded PostgreSQL test URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	defer pool.Close()

	identifier, err := auth.NewID()
	if err != nil {
		t.Fatal("could not create listener test identifier")
	}
	applicationName := "closer-listener-cancel-" + identifier
	parsed, err := url.Parse(urlValue)
	if err != nil {
		t.Fatal("could not parse guarded PostgreSQL test URL")
	}
	query := parsed.Query()
	query.Set("application_name", applicationName)
	parsed.RawQuery = query.Encode()

	registry := realtime.NewRegistry(4)
	listenerCtx, stopListener := context.WithCancel(context.Background())
	listener := postgres.NewRealtimeListener(parsed.String(), registry, slog.New(slog.NewTextHandler(io.Discard, nil)))
	listenerDone := make(chan error, 1)
	go func() { listenerDone <- listener.Run(listenerCtx) }()
	waitForListenerConnectionState(t, pool, applicationName, true)

	stopListener()
	select {
	case err := <-listenerDone:
		if err != nil {
			t.Fatal("listener returned an error after normal context cancellation")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("listener goroutine did not exit after context cancellation")
	}
	waitForListenerConnectionState(t, pool, applicationName, false)

	const pairID = "00000000-0000-4000-8000-000000000001"
	subscription, err := registry.Subscribe(pairID)
	if err != nil {
		t.Fatal("registry was unusable after listener cancellation")
	}
	registry.Publish(realtime.Event{Version: realtime.Version, PairID: pairID, Type: realtime.PairChanged})
	select {
	case event := <-subscription.Events:
		if event.Type != realtime.PairChanged {
			t.Fatal("registry published an unexpected event after listener cancellation")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("registry stopped delivering events after listener cancellation")
	}
	subscription.Close()
	registry.Close()
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatal("PostgreSQL test pool was unhealthy after listener cancellation")
	}
}

func waitForListenerConnectionState(t *testing.T, pool *postgres.Pool, applicationName string, wantPresent bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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
			t.Fatal("listener did not reach the expected PostgreSQL connection state")
		case <-ticker.C:
		}
	}
}
