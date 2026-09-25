# Go API PostgreSQL migrations

`000001_baseline.sql` is the canonical Go API schema. It describes the final
prelaunch schema; the earlier development schema steps are folded into this
single baseline because no production data is being migrated from Drizzle or
Better Auth. SQLC reads this same file through `sqlc.yaml`, and the guarded
`testdb-schema` command embeds and applies it through the production runner.

Apply migrations to a PostgreSQL database with `DATABASE_URL` set:

```sh
go run ./cmd/migrate apply
```

The runner serializes concurrent deploys with a PostgreSQL advisory lock,
records each version and SHA-256 checksum in `closer_schema_migrations`, and
commits each migration with its history record in one transaction. Checksums
use LF-normalized SQL so Windows CRLF checkouts produce the same value. During
`apply`, a stored checksum matching the exact old LF or CRLF representation is
upgraded to its canonical value; any content change beyond line endings is
rejected. This compatibility path is safe for the pre-production local schemas
that used the earlier raw-byte checksum.

At the repository root, `bun run db:status` reports migration state and
`bun run db:check` returns success only when the database has exactly the
checkout's known migration history. Both are read-only; they do not create the
migration table or build a shadow schema. `bun run dev` runs this check before
starting Vite or the API. Only the explicit `bun run db:migrate` applies
pending migrations. It never resets data. `go run ./cmd/migrate verify` remains
the explicit deeper check: it verifies checksums and compares live tables,
columns, enums, constraints, and indexes against a shadow schema built from the
canonical migration. This is a one-way baseline; destructive down migrations
are not provided.

The test-only bootstrap remains restricted to the local `closer_test`
database. `go run ./cmd/testdb-schema reset` drops that database's `public`
schema and reapplies the canonical migration; `apply` only applies pending
migrations.
