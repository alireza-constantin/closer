// Command migrate applies or verifies the Go API PostgreSQL schema.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/alireza-constantin/closer/apps/api/db/migrations"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

func main() {
	if len(os.Args) != 2 || (os.Args[1] != "apply" && os.Args[1] != "verify") {
		fmt.Fprintln(os.Stderr, "usage: migrate <apply|verify>")
		os.Exit(2)
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal(fmt.Errorf("DATABASE_URL is required"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	pool, err := postgres.NewPool(ctx, databaseURL)
	if err != nil {
		fatal(fmt.Errorf("connect to database: %w", err))
	}
	defer pool.Close()
	if os.Args[1] == "apply" {
		applied, err := migrations.Apply(ctx, pool)
		if err != nil {
			fatal(err)
		}
		fmt.Printf("Database migrations complete (%d applied).\n", applied)
	}
	if err := migrations.Verify(ctx, pool); err != nil {
		fatal(err)
	}
	fmt.Println("Database migration history verified.")
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
