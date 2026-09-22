package postgres_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
	"github.com/alireza-constantin/closer/apps/api/internal/realtime"
	"github.com/jackc/pgx/v5"
)

func openRealtimeTestConnection(t *testing.T) *pgx.Conn {
	t.Helper()
	url, err := testdb.LoadURL()
	if err != nil {
		if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
			t.Skip("set CLOSER_TEST_DATABASE_URL to run PostgreSQL realtime integration checks")
		}
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connection, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(context.Background()) })
	return connection
}

func waitForRealtimeEvent(t *testing.T, connection *pgx.Conn) realtime.Event {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	notification, err := connection.WaitForNotification(ctx)
	if err != nil {
		t.Fatal(err)
	}
	event, err := realtime.Decode([]byte(notification.Payload))
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func TestTransactionalRealtimePublisherCommitsAfterBusinessTransaction(t *testing.T) {
	listener := openRealtimeTestConnection(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := listener.Exec(ctx, "LISTEN "+postgres.RealtimeChannel); err != nil {
		t.Fatal(err)
	}
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	want := realtime.Event{Version: realtime.Version, PairID: "00000000-0000-4000-8000-000000000001", Type: realtime.PairChanged}
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		return postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, want)
	}); err != nil {
		t.Fatal(err)
	}
	if got := waitForRealtimeEvent(t, listener); got != want {
		t.Fatalf("event = %+v, want %+v", got, want)
	}
}

func TestTransactionalRealtimePublisherRollsBackWithBusinessTransaction(t *testing.T) {
	listener := openRealtimeTestConnection(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := listener.Exec(ctx, "LISTEN "+postgres.RealtimeChannel); err != nil {
		t.Fatal(err)
	}
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	want := realtime.Event{Version: realtime.Version, PairID: "00000000-0000-4000-8000-000000000002", Type: realtime.PairChanged}
	wantErr := errors.New("rollback test")
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		if err := postgres.NewTransactionalRealtimePublisher(db).Publish(ctx, want); err != nil {
			return err
		}
		return wantErr
	}); !errors.Is(err, wantErr) {
		t.Fatalf("transaction error = %v, want %v", err, wantErr)
	}
	short, shortCancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer shortCancel()
	if _, err := listener.WaitForNotification(short); err == nil {
		t.Fatal("rolled-back notification reached LISTEN")
	}
}
