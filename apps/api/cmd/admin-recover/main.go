package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/alireza-constantin/closer/apps/api/internal/auth"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	postgresauth "github.com/alireza-constantin/closer/apps/api/internal/postgres/auth"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "admin recovery failed:", err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL, err := requiredEnv("DATABASE_URL")
	if err != nil {
		return err
	}
	adminEmail, err := requiredEnv("ADMIN_BOOTSTRAP_EMAIL")
	if err != nil {
		return err
	}
	password, err := requiredEnv("ADMIN_RECOVERY_PASSWORD")
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), postgres.ConnectTimeout+postgres.CommandTimeout)
	defer cancel()
	database, err := postgres.NewPool(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	store := postgresauth.NewStore(database)
	result, err := auth.NewServiceWithCredentials(store, store, nil).RecoverAdmin(ctx, adminEmail, password)
	if err != nil {
		return err
	}
	fmt.Printf("Recovered Admin auth user %s; revoked %d session(s).\n", result.AuthUserID, result.RevokedSessionCount)
	return nil
}

func requiredEnv(name string) (string, error) {
	value, ok := os.LookupEnv(name)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}
