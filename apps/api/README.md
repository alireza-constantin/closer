# Go API foundation

The API uses Go 1.25.1, as declared in `go.mod`. Set `HTTP_ADDR` and
`DATABASE_URL` before starting it. `HTTP_SHUTDOWN_TIMEOUT` is optional and
defaults to `10s`. Set `CLOSER_TRUSTED_ORIGINS` to comma-separated exact origins
before using cookie-authenticated mutations. Local development can include the
Vite origin (for example `http://localhost:5173`); Production must include the
canonical HTTPS app origin. Empty configuration fails closed for auth writes.
Set `CLOSER_TRUSTED_PROXY_CIDRS` only to the CIDRs of reverse proxies that
overwrite `X-Forwarded-For`. Without a configured trusted proxy, rate limits use
the direct connection address and ignore forwarded headers. For a trusted
proxy, the API walks the validated forwarding chain from the API-facing side
and selects the first untrusted address; malformed or oversized chains fall
back to the proxy peer.
Startup validates and pings PostgreSQL before opening the HTTP listener.
`/healthz` reports process health; `/readyz` pings the pool and returns `503`
while PostgreSQL is unavailable.

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

From the repository root, `bun run api:test` runs the Go tests serially (the
integration suites share the guarded local database) and
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
Schema bootstrap DDL is kept separately in `db/schema/` and applied in numeric
order. This is the reproducible pre-launch rewrite schema, not the final
production migration framework. A reviewed, versioned migration baseline must
be created and tested before any real production users exist. Query source stays
in `db/queries/`; schema DDL does not belong there.

PostgreSQL integration tests require an explicit `CLOSER_TEST_DATABASE_URL`.
The guard accepts only a loopback/local host and the exact database name
`closer_test`; there is no fallback to application DB URLs. Tests skip when the
variable is absent and fail if it points elsewhere.

Legacy TypeScript/Next integration tests use a separate explicit
`CLOSER_LEGACY_TEST_DATABASE_URL` targeting the loopback database
`closer_legacy_test`. The two runtimes intentionally have incompatible identity
schemas and must never alternate schemas in one physical database. The legacy
test command supplies test-only `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and an
absent `ADMIN_USER_ID`; it never falls back to `DATABASE_URL`,
`CLOSER_TEST_DATABASE_URL`, or `closer_dev`.

The purpose-built Go auth schema is defined in `db/schema/001_auth.sql` and is
independent of the legacy Better Auth schema. The new Go runtime owns UUID
`auth_user.id`; the legacy Next runtime retains its Better Auth text IDs only
as a behavioral reference. The runtimes do not share physical identity rows,
and no identity mapping layer exists. Drizzle remains the semantic reference
for Closer domain behavior while Go owns executable rewrite DDL. It uses
UUID auth identities, unique normalized-email credentials, and stores only
SHA-256 session-token hashes. Consumer passwords use the frozen Argon2id policy
in `internal/auth/credentials.go`. Anonymous identity creation is explicit at
`POST /api/v1/auth/anonymous`; `GET /api/v1/me` and route prefetch remain
read-only. The schema includes `auth_user`, `auth_credential`, `auth_session`,
`auth_rate_limit`, and `admin_user`. Admin authorization requires both
`auth_user.kind = 'admin'` and an `admin_user` row; no Admin identity creates a
Participant. `db/schema/002_participant_pair.sql` adds the GO-04 domain
foundation and `db/schema/003_initial_invite.sql` adds the GO-05 initial invite
and exact first membership-era relationships. Both reference the Go UUID auth
identity.

The Go Admin operator commands are separate from the legacy TypeScript
`admin:bootstrap` and `admin:recover` scripts. They read only process
environment variables and do not load dotenv files:

- `api:admin-bootstrap` requires `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, and
  `ADMIN_BOOTSTRAP_PASSWORD`. It creates a dedicated Admin only when that email
  is unused; a retry is a no-op only for an existing Admin at that email.
- `api:admin-recover` requires `DATABASE_URL`, the configured
  `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_RECOVERY_PASSWORD`. It changes only that
  existing Admin's password and revokes that Admin's sessions.

Both commands are manual operator actions, never deployment commands. They
print the Admin auth user ID and operation result but never print passwords or
hashes. Remove temporary password variables after the operation. Verify the
database target before invoking either command; they are not run as part of
GO-03 verification. Consumer and Admin login limits are durable in PostgreSQL.
Daily cleanup removes expired or revoked sessions and old rate-limit windows
in batches of at most 500 rows.
