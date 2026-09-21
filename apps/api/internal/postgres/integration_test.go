package postgres_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func openTestPool(t *testing.T) *postgres.Pool {
	t.Helper()
	if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
		t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL integration checks")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Fatalf("open guarded PostgreSQL test pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestPoolPingAndClose(t *testing.T) {
	pool := openTestPool(t)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("Ping() error = %v", err)
	}
	pool.Close()
	if err := pool.Ping(context.Background()); err == nil {
		t.Fatal("Ping() succeeded after pool close")
	}
}

func TestTransactionCommitAndRollback(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()

	err := pool.WithinTx(ctx, func(tx postgres.QueryDB) error {
		queries := sqlc.New(tx)
		if _, err := queries.SetLocalTestValue(ctx, "committed"); err != nil {
			return err
		}
		value, err := queries.GetLocalTestValue(ctx)
		if err != nil {
			return err
		}
		if value != "committed" {
			t.Fatalf("transaction-local value = %q, want committed", value)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("commit transaction: %v", err)
	}

	callbackErr := errors.New("rollback requested by test")
	err = pool.WithinTx(ctx, func(tx postgres.QueryDB) error {
		queries := sqlc.New(tx)
		if _, err := queries.SetLocalTestValue(ctx, "rolled-back"); err != nil {
			return err
		}
		value, err := queries.GetLocalTestValue(ctx)
		if err != nil {
			return err
		}
		if value != "rolled-back" {
			t.Fatalf("transaction-local value = %q, want rolled-back", value)
		}
		return callbackErr
	})
	if !errors.Is(err, callbackErr) {
		t.Fatalf("rollback transaction error = %v, want callback error", err)
	}

	if err := pool.WithinTx(ctx, func(tx postgres.QueryDB) error {
		queries := sqlc.New(tx)
		value, err := queries.GetLocalTestValue(ctx)
		if err != nil {
			return err
		}
		if value != "" {
			t.Fatalf("transaction-local value leaked after transaction: %q", value)
		}
		return nil
	}); err != nil {
		t.Fatalf("transaction after rollback: %v", err)
	}
}

func TestTransactionRollsBackWhenContextIsCanceled(t *testing.T) {
	pool := openTestPool(t)
	ctx, cancel := context.WithCancel(context.Background())
	err := pool.WithinTx(ctx, func(tx postgres.QueryDB) error {
		queries := sqlc.New(tx)
		if _, err := queries.SetLocalTestValue(ctx, "canceled"); err != nil {
			return err
		}
		cancel()
		return nil
	})
	cancel()
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("WithinTx() error = %v, want context.Canceled", err)
	}
	if err := pool.WithinTx(context.Background(), func(tx postgres.QueryDB) error {
		queries := sqlc.New(tx)
		value, err := queries.GetLocalTestValue(context.Background())
		if err != nil {
			return err
		}
		if value != "" {
			t.Fatalf("transaction-local value leaked after cancellation: %q", value)
		}
		return nil
	}); err != nil {
		t.Fatalf("transaction after cancellation: %v", err)
	}
}

func TestDedicatedListenerConnectionLifecycle(t *testing.T) {
	if _, ok := os.LookupEnv(testdb.DatabaseURLEnv); !ok {
		t.Skip("set CLOSER_TEST_DATABASE_URL to an approved local test database to run PostgreSQL integration checks")
	}
	url, err := testdb.LoadURL()
	if err != nil {
		t.Fatalf("load guarded PostgreSQL test URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connection, err := postgres.ConnectListener(ctx, url)
	if err != nil {
		t.Fatalf("connect dedicated listener session: %v", err)
	}
	if err := connection.Close(ctx); err != nil {
		t.Fatalf("close dedicated listener session: %v", err)
	}
}
