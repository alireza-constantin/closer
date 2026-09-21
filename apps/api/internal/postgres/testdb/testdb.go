// Package testdb provides the explicit, local-only database boundary for
// PostgreSQL integration tests. It never falls back to DATABASE_URL. Schema
// reset is a separate explicit command and is guarded to closer_test only.
package testdb

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
	"github.com/alireza-constantin/closer/apps/api/internal/postgres/sqlc"
	"github.com/jackc/pgx/v5"
)

const DatabaseURLEnv = "CLOSER_TEST_DATABASE_URL"

// URLFromEnv requires the explicit integration-test URL. Application and
// development URLs are deliberately not considered.
func URLFromEnv(lookup func(string) (string, bool)) (string, error) {
	if lookup == nil {
		return "", errors.New("test database environment lookup is required")
	}
	databaseURL, ok := lookup(DatabaseURLEnv)
	if !ok || strings.TrimSpace(databaseURL) == "" {
		return "", fmt.Errorf("%s is required for PostgreSQL integration tests", DatabaseURLEnv)
	}
	databaseURL = strings.TrimSpace(databaseURL)
	if err := ValidateTarget(databaseURL); err != nil {
		return "", err
	}
	return databaseURL, nil
}

// LoadURL reads and validates the integration-test target from the process
// environment without printing its value.
func LoadURL() (string, error) {
	return URLFromEnv(os.LookupEnv)
}

// ValidateTarget refuses non-test database names and non-local hosts before
// any test connection can be opened. A separately named Neon test branch is
// unnecessary for this test harness and is therefore refused as well.
func ValidateTarget(databaseURL string) error {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return errors.New("invalid test database URL")
	}
	if config.Database != "closer_test" {
		return errors.New("test database name must be exactly closer_test")
	}
	if !localHostList(config.Host) {
		return errors.New("test database host must be loopback or localhost")
	}
	return nil
}

// OpenPool opens only the validated test database and confirms the connected
// server selected the expected database before returning it to a test.
func OpenPool(ctx context.Context) (*postgres.Pool, error) {
	databaseURL, err := LoadURL()
	if err != nil {
		return nil, err
	}

	pool, err := postgres.NewPool(ctx, databaseURL)
	if err != nil {
		return nil, err
	}

	var connectedDatabase string
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		queries := sqlc.New(db)
		var queryErr error
		connectedDatabase, queryErr = queries.CurrentDatabase(ctx)
		return queryErr
	})
	if err != nil {
		pool.Close()
		return nil, errors.New("unable to confirm the PostgreSQL test database")
	}
	if connectedDatabase != "closer_test" {
		pool.Close()
		return nil, errors.New("connected PostgreSQL database is not an approved test target")
	}
	return pool, nil
}

func localHostList(hosts string) bool {
	if strings.TrimSpace(hosts) == "" {
		return false
	}
	for _, host := range strings.Split(hosts, ",") {
		host = strings.Trim(host, "[]")
		if strings.EqualFold(host, "localhost") {
			continue
		}
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return false
		}
	}
	return true
}
