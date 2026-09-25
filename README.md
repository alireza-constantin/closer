# Closer

Closer is a React + Vite installable web app backed by a Go HTTP API and PostgreSQL.

```text
React + Vite PWA  →  Go API (JSON + SSE)  →  PostgreSQL
```

The Vite app contains the consumer flows, Admin question authoring, and Admin analytics. The Go API owns authentication, authorization, domain transitions, persistence, and realtime events. PostgreSQL schema changes use the versioned Go migration baseline in `apps/api/db/migrations`.

## Local development

Requirements: Bun 1.4.2, Go 1.25.1, and a locally installed PostgreSQL server. Start PostgreSQL yourself; `bun run dev` never starts, stops, initializes, or resets a database.

1. Install Bun, Go, and PostgreSQL, then start your local PostgreSQL server.
2. Create a development database named `closer_dev`. For example, with PostgreSQL command-line tools installed and a local admin role named `postgres`:

   ```powershell
   createdb --host 127.0.0.1 --port 5435 --username postgres closer_dev
   ```

   Change the host, port, and admin role to match your local PostgreSQL installation. The application role in the connection URL below must be able to connect to and create schema objects in `closer_dev`.

3. Copy `apps/api/.env.example` to `apps/api/.env.local` and replace `CHANGE_ME` with your local PostgreSQL password. This ignored file configures `DATABASE_URL`, `HTTP_ADDR`, and the local trusted browser origin. Keep `closer_dev` separate from the integration-test database `closer_test`.
4. Install workspace dependencies and inspect the local schema state:

   ```powershell
   bun install
   bun run db:status
   ```

5. Start both app processes from the repository root:

   ```powershell
   bun run dev
   ```

Before starting either process, `bun run dev` runs the read-only migration check. If the local database is behind, the command prints the pending migration names and stops. Apply them explicitly, then retry:

```powershell
bun run db:migrate
bun run dev
```

`bun run db:migrate` applies pending migrations only; it never resets the database. `bun run db:status` shows the configured database name, server, and migration state without changing it. The combined `dev` command runs the Go API and Vite in the same terminal with `dev:api` and `dev:web` log prefixes. If either process exits with an error, the other is stopped. Press `Ctrl+C` to stop both.

The frontend is at `http://localhost:5173`; the API is at `http://127.0.0.1:8080` and its health endpoint is `http://127.0.0.1:8080/healthz`. The browser calls same-origin `/api/v1` paths, which Vite proxies to the API without changing the browser `Origin`; set `CLOSER_TRUSTED_ORIGINS` to the exact frontend origin shown above. Session cookies and EventSource use that same-origin path. Set `VITE_API_PROXY_TARGET` only when the API listens at a different address.

API startup checks `DATABASE_URL` and exits with a sanitized `PostgreSQL is unavailable` error when PostgreSQL cannot be reached or the credentials fail. It does not fall back to `closer_test` or a remote database.

Process environment variables take precedence over `apps/api/.env.local`. The API and migration commands load that ignored file when present. Never put production credentials in it. The committed `.env.example` contains placeholders only.

## Environment variables

| Area                         | Variable                                                                       | Requirement and purpose                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Go API                       | `HTTP_ADDR`                                                                    | Required listener address; local default is `127.0.0.1:8080`.                                                          |
| API and migrations           | `DATABASE_URL`                                                                 | Required PostgreSQL URL. Local development must target `closer_dev`; never use `closer_test` here.                     |
| Browser security             | `CLOSER_TRUSTED_ORIGINS`                                                       | Exact browser origins allowed to make cookie-authenticated mutations. Local default is `http://localhost:5173`.        |
| Realtime                     | `REALTIME_DATABASE_URL`                                                        | Optional dedicated PostgreSQL URL for LISTEN; defaults to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.                |
| Realtime                     | `DATABASE_URL_UNPOOLED`                                                        | Optional direct PostgreSQL URL used as the realtime fallback.                                                          |
| Vite development             | `VITE_API_PROXY_TARGET`                                                        | Optional API proxy target; defaults to `http://127.0.0.1:8080`.                                                        |
| PostgreSQL integration tests | `CLOSER_TEST_DATABASE_URL`                                                     | Test-only URL. Keep it pointed at a separate loopback `closer_test`; it is never used by the API or migration command. |
| Auth / proxy security        | `CLOSER_TRUSTED_PROXY_CIDRS`                                                   | Optional CIDRs for trusted reverse proxies. Not needed for local development.                                          |
| Go API                       | `HTTP_SHUTDOWN_TIMEOUT`                                                        | Optional positive Go duration; defaults to `10s`.                                                                      |
| Admin operator               | `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_RECOVERY_PASSWORD` | Set only for explicit Admin operator commands.                                                                         |

There are no runtime requirements for Next.js, Better Auth, Drizzle, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, or a legacy Admin user ID.

## Database and tests

Normal development uses `closer_dev`. Git is the source of truth for migration files, while each computer's local database records its own applied migrations. After pulling or switching branches, run `bun run dev`; its migration preflight blocks stale or incompatible local schemas. Inspect status at any time with:

```powershell
bun run db:status
```

When the check reports pending migrations, explicitly apply them with:

```sh
bun run db:migrate
```

This command reads `DATABASE_URL` from the process or `apps/api/.env.local` and applies pending Go migrations. It does not create or reset a database. Review the target before running it outside local development. Never casually edit an already-applied migration; create a new migration for schema changes. Normal database commands refuse a URL targeting `closer_test`.

PostgreSQL integration tests use only the explicit `CLOSER_TEST_DATABASE_URL` and require local `closer_test`. The guarded reset is destructive to that test database only; never point it at `closer_dev` or another database:

```sh
bun run api:schema:reset:test
bun run api:test
```

An optional Compose test database is available for developers who choose it. It is not part of `bun run dev` or the normal local PostgreSQL setup.

Canonical local verification commands:

```sh
# Go API
cd apps/api
go fmt ./...
go vet ./...
go test -p 1 -count=1 ./...
go build ./...
cd ../..
bun run api:test
bun run api:build

# Vite app
bun run --filter web-vite test
bun run --filter web-vite check-types
bun run --filter web-vite build

# Workspace
bun run test
bun run check-types
bun run build
```

SQLC is pinned to v1.31.1 in CI. Generate twice from `apps/api` and confirm the second run has no content changes:

```sh
cd apps/api
sqlc generate
git diff --exit-code -- internal/postgres
sqlc generate
git diff --exit-code -- internal/postgres
```

## Deployment shape

Deploy a static Vite build, the Go API process, and PostgreSQL. Serve the SPA and API on one HTTPS origin so session cookies and the exact-origin mutation policy remain straightforward. The static host must route `/api/*` to the Go API and fall back to `index.html` for client-side routes; do not route API misses to the SPA fallback. Configure `CLOSER_TRUSTED_ORIGINS` with the exact public frontend origin and configure proxy CIDRs only for proxies you control.

For Caddy or another reverse proxy, route `/api/*` to the Go listener and serve `apps/web-vite/dist` with an SPA fallback. The API owns paths under `/api/v1`; the Vite development proxy is not a production server.

Admin bootstrap and recovery are operator commands, not public signup flows. Keep their credentials short-lived and out of source control and logs. This repository does not deploy, migrate production, or configure DNS.

Run the operator commands only after setting the corresponding Admin variables in the environment:

```sh
bun run api:admin-bootstrap
bun run api:admin-recover
```
