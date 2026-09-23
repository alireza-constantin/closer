# Go API

The Go API is the server authority for authentication, Pair and Participant state, invitations, questions, Private and Together flows, Admin operations, analytics, and SSE invalidations. PostgreSQL is the persistence layer; SQLC-generated queries live under `internal/postgres`.

## Run locally

From the repository root, set `HTTP_ADDR=127.0.0.1:8080` and `DATABASE_URL` to a local PostgreSQL URL, then run:

```sh
bun run api:run
```

The API requires an applied schema. Local setup and the full environment inventory are in the root README. Runtime env takes precedence over `apps/api/.env.local` and root `.env.local`.

## Migrations

`db/migrations/000001_baseline.sql` is the authoritative schema baseline. Migrations are embedded, ordered, checksummed, applied under a PostgreSQL advisory lock, and recorded in `closer_schema_migrations`. Reapplying the same migration is a no-op; changed migration bytes or schema drift fail verification.

For an explicitly selected database:

```sh
go run ./cmd/migrate apply
go run ./cmd/migrate verify
```

Both commands require `DATABASE_URL`. Review the target before invoking them. The guarded test bootstrap is a separate command and accepts only loopback PostgreSQL database `closer_test`:

```sh
go run ./cmd/testdb-schema reset
```

## Verification

```sh
go fmt ./...
go vet ./...
go test -p 1 -count=1 ./...
go build ./...
```

PostgreSQL integration tests use `CLOSER_TEST_DATABASE_URL` and skip when it is unset. They never fall back to `DATABASE_URL`. SQLC version 1.31.1 is pinned in CI; after query or schema edits, generate twice and ensure the second generation makes no content changes.

## Realtime and API routes

The server starts a dedicated PostgreSQL LISTEN connection using `REALTIME_DATABASE_URL`, falling back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`. SSE endpoints expose Pair-scoped invalidation metadata only; clients fetch authorized content through the versioned JSON API.

The production frontend is static Vite output. Serve frontend paths with an SPA fallback and proxy `/api/*` to this API without stripping the prefix. The API serves `/api/v1/*`.
