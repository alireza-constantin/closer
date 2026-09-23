// Package migrations applies the canonical PostgreSQL schema for the Go API.
package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/alireza-constantin/closer/apps/api/internal/postgres"
)

//go:embed *.sql
var files embed.FS

const lockID int64 = 0x434c4f534552
const historyTable = "closer_schema_migrations"

type migration struct {
	version  string
	contents []byte
	checksum string
}

func load() ([]migration, error) {
	paths, err := fs.Glob(files, "*.sql")
	if err != nil {
		return nil, fmt.Errorf("list embedded migrations: %w", err)
	}
	sort.Strings(paths)
	loaded := make([]migration, 0, len(paths))
	for _, path := range paths {
		contents, err := files.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read embedded migration %s: %w", path, err)
		}
		sum := sha256.Sum256(contents)
		loaded = append(loaded, migration{version: strings.TrimSuffix(path, ".sql"), contents: contents, checksum: hex.EncodeToString(sum[:])})
	}
	if len(loaded) == 0 {
		return nil, errors.New("no embedded database migrations found")
	}
	return loaded, nil
}

// Apply runs pending migrations in version order. Each migration and its history
// record commit atomically; a session advisory lock prevents concurrent runners.
func Apply(ctx context.Context, pool *postgres.Pool) (int, error) {
	loaded, err := load()
	if err != nil {
		return 0, err
	}
	var applied int
	err = pool.WithConnection(ctx, func(lock postgres.QueryDB) error {
		if _, err := lock.Exec(ctx, "SELECT pg_advisory_lock($1)", lockID); err != nil {
			return fmt.Errorf("acquire migration lock: %w", err)
		}
		defer func() {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = lock.Exec(releaseCtx, "SELECT pg_advisory_unlock($1)", lockID)
		}()

		if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
			_, err := db.Exec(ctx, `CREATE TABLE IF NOT EXISTS `+historyTable+` (
				version text PRIMARY KEY,
				checksum text NOT NULL,
				applied_at timestamptz NOT NULL DEFAULT now()
			)`)
			return err
		}); err != nil {
			return fmt.Errorf("create migration history: %w", err)
		}

		known := make(map[string]string)
		rows, err := lock.Query(ctx, "SELECT version, checksum FROM "+historyTable)
		if err != nil {
			return fmt.Errorf("read migration history: %w", err)
		}
		for rows.Next() {
			var version, checksum string
			if err := rows.Scan(&version, &checksum); err != nil {
				rows.Close()
				return fmt.Errorf("scan migration history: %w", err)
			}
			known[version] = checksum
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("read migration history: %w", err)
		}
		if len(known) > len(loaded) {
			return fmt.Errorf("migration history contains %d entries but this release knows %d", len(known), len(loaded))
		}
		for version := range known {
			found := false
			for _, item := range loaded {
				if item.version == version {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("database records unknown migration %s", version)
			}
		}

		for _, item := range loaded {
			if checksum, ok := known[item.version]; ok {
				if checksum != item.checksum {
					return fmt.Errorf("migration %s checksum differs from the applied version", item.version)
				}
				continue
			}
			for version := range known {
				if version > item.version {
					return fmt.Errorf("migration %s is pending before already-applied migration %s", item.version, version)
				}
			}
			if err := pool.WithinTx(ctx, func(db postgres.QueryDB) error {
				if _, err := db.Exec(ctx, string(item.contents)); err != nil {
					return fmt.Errorf("execute migration %s: %w", item.version, err)
				}
				_, err := db.Exec(ctx, "INSERT INTO "+historyTable+" (version, checksum) VALUES ($1, $2)", item.version, item.checksum)
				return err
			}); err != nil {
				return err
			}
			applied++
		}
		return nil
	})
	if err != nil {
		return applied, err
	}
	return applied, nil
}

// Verify checks migration checksums. The schema is single-sourced: sqlc reads
// the same embedded baseline file that Apply executes against PostgreSQL.
func Verify(ctx context.Context, pool *postgres.Pool) error {
	loaded, err := load()
	if err != nil {
		return err
	}
	if err := pool.WithConnection(ctx, func(db postgres.QueryDB) error {
		rows, err := db.Query(ctx, "SELECT version, checksum FROM "+historyTable)
		if err != nil {
			return fmt.Errorf("read migration history for verification: %w", err)
		}
		defer rows.Close()
		known := make(map[string]string)
		for rows.Next() {
			var version, checksum string
			if err := rows.Scan(&version, &checksum); err != nil {
				return fmt.Errorf("scan migration history: %w", err)
			}
			known[version] = checksum
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("read migration history: %w", err)
		}
		if len(known) != len(loaded) {
			return fmt.Errorf("migration history has %d entries; expected %d", len(known), len(loaded))
		}
		for _, item := range loaded {
			if checksum, ok := known[item.version]; !ok || checksum != item.checksum {
				return fmt.Errorf("migration %s is missing or has a different checksum", item.version)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	return verifySchema(ctx, pool, loaded)
}

// verifySchema compares PostgreSQL catalog objects from the live public schema
// with a shadow schema built from the canonical migration. It compares typed
// catalog facts rather than SQL file text, so manual schema drift is detected.
func verifySchema(ctx context.Context, pool *postgres.Pool, loaded []migration) error {
	const expectedSchema = "closer_migration_expected"
	return pool.WithinTx(ctx, func(db postgres.QueryDB) error {
		if _, err := db.Exec(ctx, "DROP SCHEMA IF EXISTS "+expectedSchema+" CASCADE; CREATE SCHEMA "+expectedSchema); err != nil {
			return fmt.Errorf("create migration verification schema: %w", err)
		}
		if _, err := db.Exec(ctx, "SET LOCAL search_path TO "+expectedSchema+", public"); err != nil {
			return fmt.Errorf("set migration verification search path: %w", err)
		}
		for _, item := range loaded {
			if _, err := db.Exec(ctx, string(item.contents)); err != nil {
				return fmt.Errorf("build expected schema from migration %s: %w", item.version, err)
			}
		}
		actual, err := catalogObjects(ctx, db, "public")
		if err != nil {
			return fmt.Errorf("inspect live database schema: %w", err)
		}
		expected, err := catalogObjects(ctx, db, expectedSchema)
		if err != nil {
			return fmt.Errorf("inspect expected database schema: %w", err)
		}
		if len(actual) != len(expected) {
			return fmt.Errorf("database schema drift: found %d catalog objects, expected %d", len(actual), len(expected))
		}
		for i := range expected {
			if actual[i] != expected[i] {
				return fmt.Errorf("database schema drift at catalog object %d: found %q, expected %q", i+1, actual[i], expected[i])
			}
		}
		if _, err := db.Exec(ctx, "DROP SCHEMA "+expectedSchema+" CASCADE"); err != nil {
			return fmt.Errorf("remove migration verification schema: %w", err)
		}
		return nil
	})
}

func catalogObjects(ctx context.Context, db postgres.QueryDB, schema string) ([]string, error) {
	const query = `
WITH objects AS (
    SELECT 'table:' || c.relname AS object
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND c.relname <> 'closer_schema_migrations'
    UNION ALL
    SELECT 'column:' || c.relname || '.' || a.attnum || ':' || a.attname || ':' ||
        replace(replace(format_type(a.atttypid, a.atttypmod), $2 || '.', ''), $3 || '.', '') || ':' || a.attnotnull || ':' ||
        replace(replace(COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), $2 || '.', ''), $3 || '.', '') || ':' || a.attgenerated::text || ':' || a.attidentity::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND c.relname <> 'closer_schema_migrations'
    UNION ALL
    SELECT 'enum:' || t.typname || ':' || e.enumsortorder || ':' || e.enumlabel
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = $1
    UNION ALL
    SELECT 'constraint:' || c.relname || ':' || con.conname || ':' || con.contype::text || ':' ||
        replace(replace(pg_get_constraintdef(con.oid, true), $2 || '.', ''), $3 || '.', '')
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname <> 'closer_schema_migrations'
    UNION ALL
    SELECT 'index:' || tbl.relname || ':' || idx.relname || ':' || i.indisunique || ':' ||
        i.indisprimary || ':' || i.indisvalid || ':' ||
        replace(replace(pg_get_indexdef(i.indexrelid), $2 || '.', ''), $3 || '.', '')
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = $1 AND tbl.relname <> 'closer_schema_migrations'
)
SELECT object FROM objects ORDER BY object`
	rows, err := db.Query(ctx, query, schema, "public", "closer_migration_expected")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var object string
		if err := rows.Scan(&object); err != nil {
			return nil, err
		}
		result = append(result, object)
	}
	return result, rows.Err()
}
