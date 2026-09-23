// Command testdb-schema applies or resets the isolated Go rewrite test schema.
// It accepts only CLOSER_TEST_DATABASE_URL targeting local closer_test.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/alireza-constantin/closer/apps/api/db/migrations"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/testdb"
)

func main() {
	if len(os.Args) != 2 || (os.Args[1] != "apply" && os.Args[1] != "reset") {
		fmt.Fprintln(os.Stderr, "usage: testdb-schema <apply|reset>")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	p, err := testdb.OpenPool(ctx)
	if err != nil {
		fatal(err)
	}
	defer p.Close()

	if os.Args[1] == "reset" {
		if err := p.WithinTx(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, "DROP SCHEMA public CASCADE; CREATE SCHEMA public")
			return err
		}); err != nil {
			fatal(fmt.Errorf("reset guarded test schema: %w", err))
		}
	}
	if applied, err := migrations.Apply(ctx, p); err != nil {
		fatal(err)
	} else if err := migrations.Verify(ctx, p); err != nil {
		fatal(err)
	} else {
		fmt.Printf("Go rewrite schema %s applied to guarded local closer_test (%d migrations applied).\n", os.Args[1], applied)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
