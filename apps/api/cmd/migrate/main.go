// Command migrate applies or verifies the Go API PostgreSQL schema.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/alireza-constantin/closer/apps/api/db/migrations"
	"github.com/alireza-constantin/closer/apps/api/internal/env"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/jackc/pgx/v5"
)

func main() {
	if len(os.Args) != 2 || !contains([]string{"apply", "verify", "status", "check"}, argument()) {
		fmt.Fprintln(os.Stderr, "usage: migrate <apply|verify|status|check>")
		os.Exit(2)
	}
	if err := env.LoadLocal(); err != nil {
		fatal(err)
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal(fmt.Errorf("DATABASE_URL is required"))
	}
	databaseConfig, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		fatal(fmt.Errorf("invalid PostgreSQL configuration"))
	}
	if databaseConfig.Database == "closer_test" {
		fatal(fmt.Errorf("normal database commands refuse closer_test; use the guarded test database workflow"))
	}
	if os.Args[1] == "status" || os.Args[1] == "check" {
		printTarget(databaseConfig)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	pool, err := postgres.NewPool(ctx, databaseURL)
	if err != nil {
		fatal(connectionMessage(err))
	}
	defer pool.Close()
	if os.Args[1] == "status" || os.Args[1] == "check" {
		status, err := migrations.Inspect(ctx, pool)
		if err != nil {
			fatal(connectionMessage(err))
		}
		printStatus(status)
		if os.Args[1] == "check" && status.State != migrations.StateCurrent {
			fmt.Fprintln(os.Stderr, "\nERROR: local database migration preflight failed.")
			if status.State == migrations.StateAhead || status.State == migrations.StateMismatch {
				fmt.Fprintln(os.Stderr, "Switch to a compatible checkout or restore the original migration, then retry bun run dev.")
			} else {
				fmt.Fprintln(os.Stderr, "Run bun run db:migrate, then retry bun run dev.")
			}
			os.Exit(1)
		}
		return
	}
	if os.Args[1] == "apply" {
		applied, err := migrations.Apply(ctx, pool)
		if err != nil {
			fatal(connectionMessage(err))
		}
		if err := migrations.Verify(ctx, pool); err != nil {
			fatal(connectionMessage(err))
		}
		fmt.Printf("Closer database migrations complete (%d applied; %d pending).\n", applied, 0)
		return
	}
	if err := migrations.Verify(ctx, pool); err != nil {
		fatal(connectionMessage(err))
	}
	fmt.Println("Database migration history verified.")
}

func argument() string {
	if len(os.Args) == 2 {
		return os.Args[1]
	}
	return ""
}

func contains(options []string, value string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}

func printTarget(config *pgx.ConnConfig) {
	fmt.Println("Closer database status")
	fmt.Printf("\nDatabase: %s\nServer:   %s:%d\n", config.Database, config.Host, config.Port)
}

func printStatus(status migrations.Status) {
	fmt.Printf("\nApplied:  %d / %d migrations\n", status.Applied, status.Total)
	if status.Current != "" {
		fmt.Printf("Current:  %s\n", status.Current)
	} else {
		fmt.Println("Current:  none")
	}
	fmt.Printf("Latest:   %s\n\nStatus: %s\n", status.Latest, status.State)
	if len(status.Pending) > 0 {
		fmt.Println("\nPending migrations:")
		for _, version := range status.Pending {
			fmt.Printf("  %s\n", version)
		}
	}
	if len(status.Unknown) > 0 {
		fmt.Println("\nApplied migration history incompatible with this checkout:")
		for _, version := range status.Unknown {
			fmt.Printf("  %s\n", version)
		}
		fmt.Println("\nPossible causes: this checkout is stale, the wrong branch is selected, or the database was migrated by newer code. Pull or switch to a compatible branch; do not roll back the database automatically.")
	}
	if len(status.Mismatch) > 0 {
		fmt.Println("\nMigrations with changed content:")
		for _, version := range status.Mismatch {
			fmt.Printf("  %s\n", version)
		}
		fmt.Println("\nRestore the original migration or use a compatible checkout. Create a new migration for schema changes.")
	}
	if status.State == migrations.StateBehind {
		fmt.Println("\nRun:\n  bun run db:migrate")
	}
}

func connectionMessage(err error) error {
	if strings.Contains(err.Error(), "PostgreSQL is unavailable") {
		return fmt.Errorf("Cannot connect to local PostgreSQL. Check that PostgreSQL is running and verify apps/api/.env.local DATABASE_URL. No fallback database was used")
	}
	return err
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
