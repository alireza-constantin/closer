# Closer

Closer is a React + Vite installable web app backed by a Go HTTP API and PostgreSQL.

```text
React + Vite PWA  →  Go API (JSON + SSE)  →  PostgreSQL
```

The Vite app contains the consumer flows, Admin question authoring, and Admin analytics. The Go API owns authentication, authorization, domain transitions, persistence, and realtime events. PostgreSQL schema changes use the versioned Go migration baseline in `apps/api/db/migrations`.

## Local development

Requirements: Bun 1.4.2, Go 1.25.1, and PostgreSQL 18. A local PostgreSQL instance can be used directly. An optional loopback-only Compose service is provided for an isolated test database; it binds port 5435 and can run only when that port is free.

1. Install workspace dependencies with `bun install`.
2. Create an empty local PostgreSQL database named `closer_test` reachable on `127.0.0.1:5435`.
3. Set `CLOSER_TEST_DATABASE_URL` to that local `closer_test` database. The Go test bootstrap rejects non-loopback hosts and any database name other than `closer_test`.
4. Apply the schema with `bun run api:schema:reset:test`.
5. In separate terminals run `bun run dev` and `bun run api:run`. Vite proxies `/api` to `http://127.0.0.1:8080` by default; override this development target with `VITE_API_PROXY_TARGET`.

Environment variables already present in the process take precedence. Root commands such as `bun run api:run` load the first existing file from `apps/api/.env.local` and root `.env.local`, in that order. Commands started with `apps/api` as their working directory load only `apps/api/.env.local`. Do not put production credentials in these files.

To start the optional test database when port 5435 is free, run `docker compose up -d closer-test-postgres`. Its default password is `closer-test-only`, and its port is bound to loopback. The guarded reset command recreates only this local test schema.

## Environment variables

| Area                    | Variable                                            | Requirement and purpose                                                                                                                                         |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go API                  | `HTTP_ADDR`                                         | Required `host:port` listener address, for example `127.0.0.1:8080`.                                                                                            |
| Database                | `DATABASE_URL`                                      | Required PostgreSQL URL for API queries and migrations.                                                                                                         |
| Realtime                | `REALTIME_DATABASE_URL`                             | Optional PostgreSQL URL for the dedicated LISTEN connection; falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.                                        |
| Realtime                | `DATABASE_URL_UNPOOLED`                             | Optional direct PostgreSQL URL used as the realtime fallback.                                                                                                   |
| Auth / browser security | `CLOSER_TRUSTED_ORIGINS`                            | Exact comma-separated HTTP(S) origins allowed to make cookie-authenticated mutations. Configure the deployed frontend origin. Empty fails closed for mutations. |
| Auth / proxy security   | `CLOSER_TRUSTED_PROXY_CIDRS`                        | Optional comma-separated CIDRs for trusted reverse proxies that set forwarded-protocol headers.                                                                 |
| Go API                  | `HTTP_SHUTDOWN_TIMEOUT`                             | Optional positive Go duration; defaults to `10s`.                                                                                                               |
| Vite development        | `VITE_API_PROXY_TARGET`                             | Optional development proxy target; defaults to `http://127.0.0.1:8080`. No Vite runtime secret or API base URL is required.                                     |
| Local Go tests          | `CLOSER_TEST_DATABASE_URL`                          | Required to run PostgreSQL integration tests; must target loopback `closer_test`. Never use a production database.                                              |
| Admin operator          | `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | Set only for the explicit one-time Admin bootstrap command.                                                                                                     |
| Admin operator          | `ADMIN_RECOVERY_PASSWORD`                           | Set only for an explicit Admin recovery command.                                                                                                                |

There are no runtime requirements for Next.js, Better Auth, Drizzle, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, or a legacy Admin user ID.

## Database and tests

The test schema bootstrap is guarded and only operates on local `closer_test`:

```sh
bun run api:schema:reset:test
bun run api:test
```

The production migration command is intentionally separate. Review the migration and database target before running it in any deployment environment:

```sh
cd apps/api
go run ./cmd/migrate apply
go run ./cmd/migrate verify
```

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
