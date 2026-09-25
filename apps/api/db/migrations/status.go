package migrations

import (
	"context"
	"fmt"
	"sort"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

type State string

const (
	StateCurrent  State = "UP TO DATE"
	StateBehind   State = "BEHIND"
	StateAhead    State = "DATABASE AHEAD / UNKNOWN MIGRATION"
	StateMismatch State = "MIGRATION MISMATCH"
)

// Status is a read-only comparison of the embedded migration history with the
// database's migration ledger. It intentionally does not verify schema by
// creating a shadow schema; that operation belongs to the explicit verify
// command, not to local startup preflight.
type Status struct {
	State    State
	Applied  int
	Total    int
	Current  string
	Latest   string
	Pending  []string
	Unknown  []string
	Mismatch []string
}

// Inspect compares migration names and canonical SHA-256 checksums without
// modifying PostgreSQL. An empty database (no migration table) has no applied
// migrations and is reported as behind.
func Inspect(ctx context.Context, pool *postgres.Pool) (Status, error) {
	loaded, err := load()
	if err != nil {
		return Status{}, err
	}
	status := Status{State: StateCurrent, Total: len(loaded), Latest: loaded[len(loaded)-1].version}
	err = pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		var historyExists bool
		if err := db.QueryRow(ctx, "SELECT to_regclass('public."+historyTable+"') IS NOT NULL").Scan(&historyExists); err != nil {
			return fmt.Errorf("inspect migration history: %w", err)
		}
		known := make(map[string]string)
		if historyExists {
			rows, err := db.Query(ctx, "SELECT version, checksum FROM "+historyTable)
			if err != nil {
				return fmt.Errorf("read migration history: %w", err)
			}
			for rows.Next() {
				var version, checksum string
				if err := rows.Scan(&version, &checksum); err != nil {
					rows.Close()
					return fmt.Errorf("read migration history: %w", err)
				}
				known[version] = checksum
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return fmt.Errorf("read migration history: %w", err)
			}
		}

		status = summarize(loaded, known)
		return nil
	})
	if err != nil {
		return Status{}, err
	}
	return status, nil
}

func summarize(loaded []migration, known map[string]string) Status {
	status := Status{State: StateCurrent, Applied: len(known), Total: len(loaded), Latest: loaded[len(loaded)-1].version}
	byVersion := make(map[string]migration, len(loaded))
	for _, item := range loaded {
		byVersion[item.version] = item
	}
	for version := range known {
		if _, ok := byVersion[version]; !ok {
			status.Unknown = append(status.Unknown, version)
		}
	}
	sort.Strings(status.Unknown)
	for _, item := range loaded {
		stored, ok := known[item.version]
		if !ok {
			status.Pending = append(status.Pending, item.version)
			continue
		}
		status.Current = item.version
		if stored != item.checksum && !contains(item.legacyChecksums, stored) {
			status.Mismatch = append(status.Mismatch, item.version)
		}
	}
	if len(status.Unknown) > 0 {
		status.State = StateAhead
		return status
	}
	if len(status.Mismatch) > 0 {
		status.State = StateMismatch
		return status
	}
	for _, pending := range status.Pending {
		for applied := range known {
			if applied > pending {
				status.Unknown = append(status.Unknown, applied)
			}
		}
	}
	if len(status.Unknown) > 0 {
		sort.Strings(status.Unknown)
		status.Unknown = unique(status.Unknown)
		status.State = StateAhead
	} else if len(status.Pending) > 0 {
		status.State = StateBehind
	}
	return status
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func unique(values []string) []string {
	if len(values) < 2 {
		return values
	}
	result := values[:1]
	for _, value := range values[1:] {
		if value != result[len(result)-1] {
			result = append(result, value)
		}
	}
	return result
}
