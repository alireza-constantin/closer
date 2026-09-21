// Command testdb-schema applies or resets the isolated Go rewrite test schema.
// It accepts only CLOSER_TEST_DATABASE_URL targeting local closer_test.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

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

	if err := p.WithinTx(ctx, func(db postgres.QueryDB) error {
		if os.Args[1] == "reset" {
			if _, err := db.Exec(ctx, "DROP SCHEMA public CASCADE; CREATE SCHEMA public"); err != nil {
				return fmt.Errorf("reset guarded test schema: %w", err)
			}
		}
		for _, path := range []string{"db/schema/001_auth.sql", "db/schema/002_participant_pair.sql", "db/schema/003_initial_invite.sql"} {
			ddl, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("read schema file %s: %w", path, err)
			}
			if _, err := db.Exec(ctx, string(ddl)); err != nil {
				return fmt.Errorf("apply schema file %s: %w", path, err)
			}
		}
		return nil
	}); err != nil {
		fatal(err)
	}
	fmt.Printf("Go rewrite schema %s applied to guarded local closer_test.\n", os.Args[1])
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
