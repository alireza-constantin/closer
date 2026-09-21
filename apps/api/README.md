# Go API foundation

The API uses Go 1.25.1, as declared in `go.mod`. Set `HTTP_ADDR` and
`DATABASE_URL` before starting it. `HTTP_SHUTDOWN_TIMEOUT` is optional and
defaults to `10s`. Startup validates and pings PostgreSQL before opening the
HTTP listener. `/healthz` reports process health; `/readyz` pings the pool and
returns `503` while PostgreSQL is unavailable.

```powershell
$env:HTTP_ADDR = '127.0.0.1:8080'
$env:DATABASE_URL = 'postgres://closer:local-only-password@localhost:5432/closer_dev?sslmode=disable'
bun run api:run
```

`DATABASE_URL` is the normal query pool URL. `REALTIME_DATABASE_URL` selects
the session-capable URL reserved for the future PostgreSQL listener. When it is
unset, configuration uses `DATABASE_URL_UNPOOLED` as the transition fallback,
then falls back to `DATABASE_URL` for local PostgreSQL. New deployments should
set `REALTIME_DATABASE_URL` directly; no Neon-specific application API is used.

The pool is bounded to 10 connections, with zero minimum connections and a
five-second acquire/connect timeout. PostgreSQL enforces a ten-second command
timeout on pool connections. GO-02 provides a dedicated listener connection
constructor and lifecycle, but does not start `LISTEN`, realtime fanout, or
SSE.

From the repository root, `bun run api:test` runs the Go tests and
`bun run api:build` writes the server binary under the ignored
`apps/api/build/` directory. `GET /healthz` reports process health;
`go vet ./...` and `go build ./...` can be run from `apps/api` as well.

The checked-in sqlc output is generated with SQLC v1.31.1. Install that pinned
SQLC binary for the current platform and put it on `PATH`. Run generation from
`apps/api`:

```powershell
go generate ./internal/postgres/sqlc
git diff --exit-code -- internal/postgres/sqlc
```

The first command regenerates checked-in code; the second is the drift check.
GO-02 includes only test/infrastructure SQL and no Closer domain queries or
schema migrations.

PostgreSQL integration tests require an explicit `CLOSER_TEST_DATABASE_URL`.
The guard accepts only a loopback/local host and a database named exactly
`closer_test` or beginning with `closer_test_`; there is no fallback to
`DATABASE_URL`. Tests skip when the variable is absent and fail if it points to
an unsafe target.
