# Closer Admin operator runbook

The production runtime is a static Vite frontend, the Go API, and PostgreSQL. Admin authorization uses a persisted `admin_user` record and a Go-managed session. Admin bootstrap and recovery are explicit operator commands; neither is part of deployment or public signup.

## Environment

The commands below read process environment variables only. They do not load `.env` files. Set the variables in a trusted operator shell and verify the intended `DATABASE_URL` target before running either command. Never use a production URL for local verification.

| Variable                   | Use                                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL database receiving the operation.                           |
| `ADMIN_BOOTSTRAP_EMAIL`    | Dedicated Admin email; also selects the Admin account during recovery. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Temporary password supplied only during bootstrap.                     |
| `ADMIN_RECOVERY_PASSWORD`  | Temporary replacement password supplied only during recovery.          |

Do not configure these temporary passwords as persistent application runtime variables. Do not paste them into source files, shell history, tickets, or logs.

## Bootstrap

Set `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD`, verify the database target, then run:

```sh
bun run api:admin-bootstrap
```

The command creates the Admin auth user, credential, and `admin_user` authorization row in one transaction. It does not create a Participant. A retry is idempotent for the same Admin email; an existing non-Admin account is not promoted. The command prints the auth user ID and operation result but never the password or hash. Remove the temporary password from the operator environment when finished.

## Recovery

Set `DATABASE_URL`, the configured `ADMIN_BOOTSTRAP_EMAIL`, and a temporary `ADMIN_RECOVERY_PASSWORD`, verify the database target, then run:

```sh
bun run api:admin-recover
```

Recovery targets only the Admin associated with that email, changes its password, and revokes that Admin’s active sessions. It accepts no arbitrary user ID. Remove the temporary password from the operator environment when finished.

## Release environment and routing

Configure the Go API with `HTTP_ADDR`, `DATABASE_URL`, and `CLOSER_TRUSTED_ORIGINS`. When TLS terminates at a reverse proxy, configure `CLOSER_TRUSTED_PROXY_CIDRS` only for the proxy addresses you control. `REALTIME_DATABASE_URL` may point to a session-capable PostgreSQL connection for LISTEN; otherwise the API falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.

Serve `apps/web-vite/dist` as static files with an SPA fallback for Admin routes, and proxy `/api/*` to the Go API without changing the prefix. Keep frontend and API on the same HTTPS origin where possible so the session cookie and origin policy remain straightforward.

This runbook prepares operator procedures. It does not authorize or perform deployment, database migration, DNS changes, or production account creation.
