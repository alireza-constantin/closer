package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func TestApplyIsIdempotentAndVerifyDetectsSchemaDrift(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := testdb.OpenPool(ctx)
	if err != nil {
		t.Skipf("local closer_test database is unavailable: %v", err)
	}
	defer pool.Close()

	if _, err := Apply(ctx, pool); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	applied, err := Apply(ctx, pool)
	if err != nil {
		t.Fatalf("reapply migrations: %v", err)
	}
	if applied != 0 {
		t.Fatalf("expected reapplying migrations to be a no-op, applied %d migrations", applied)
	}
	if err := Verify(ctx, pool); err != nil {
		t.Fatalf("verify clean schema: %v", err)
	}

	const probe = "closer_migration_drift_probe"
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		_, err := db.Exec(ctx, "DROP TABLE IF EXISTS public."+probe)
		return err
	}); err != nil {
		t.Fatalf("clear stale drift probe: %v", err)
	}
	if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		_, err := db.Exec(ctx, "CREATE TABLE public."+probe+" (id integer NOT NULL)")
		return err
	}); err != nil {
		t.Fatalf("create drift probe: %v", err)
	}
	defer func() {
		if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, "DROP TABLE IF EXISTS public."+probe)
			return err
		}); err != nil {
			t.Errorf("remove drift probe: %v", err)
		}
	}()
	if err := Verify(ctx, pool); err == nil {
		t.Fatal("Verify succeeded with an unexpected table in the public schema")
	}
}
