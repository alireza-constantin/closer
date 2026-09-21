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
		fmt.Fprintln(os.Stderr, "admin bootstrap failed:", err)
		os.Exit(1)
	}
}

func run() error {
	databaseURL, err := requiredEnv("DATABASE_URL")
	if err != nil {
		return err
	}
	email, err := requiredEnv("ADMIN_BOOTSTRAP_EMAIL")
	if err != nil {
		return err
	}
	password, err := requiredEnv("ADMIN_BOOTSTRAP_PASSWORD")
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
	result, err := auth.NewServiceWithCredentials(store, store, nil).BootstrapAdmin(ctx, email, password)
	if err != nil {
		return err
	}
	state := "already exists"
	if result.Created {
		state = "created"
	}
	fmt.Printf("Admin auth user %s %s.\n", result.AuthUserID, state)
	return nil
}

func requiredEnv(name string) (string, error) {
	value, ok := os.LookupEnv(name)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}
