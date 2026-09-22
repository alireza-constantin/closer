# Closer

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Self, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **PWA** - Progressive Web App support

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM and retains the `node-postgres`
driver because the app requires transactions, row locking, and session-based
PostgreSQL `LISTEN`/`NOTIFY`.

Closer currently has exactly two Neon environments:

- `development` — local development and integration testing.
- `main` — Production.

Docker Postgres remains an optional offline/local fallback. It is not the
recommended workflow and is not deleted.

### Development environment

Create or select the Neon Development branch. Never use Production credentials
locally. Copy `apps/web/.env.example` to `apps/web/.env.local` and set:

- `DATABASE_URL` to the pooled Development URL for normal application queries.
- `DATABASE_URL_UNPOOLED` to the direct Development URL for schema operations.
- `REALTIME_DATABASE_URL` to the direct Development URL for `LISTEN/NOTIFY`.
- the Better Auth and Admin development values documented in the template.

The current pre-launch workflow treats the Drizzle schema files as the source
of truth. Apply the schema explicitly:

```bash
bun run db:push
bun dev
```

Open [http://localhost:3001](http://localhost:3001) and smoke test Closer.

### Integration tests

The default `bun test` runs safe unit, frontend, parity, and harness tests. It
does not discover destructive `*.integration.test.*` files. Those suites use
only an explicit local PostgreSQL database named `closer_test`; they never fall
back to `DATABASE_URL`, `closer_dev`, Production, or Neon.

Create the database and apply the required test schema separately, then set
both guards for that shell only:

```bash
CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS=1 \
CLOSER_TEST_DATABASE_URL=postgres://closer:local-only-password@127.0.0.1:5432/closer_test \
bun run test:integration
```

PowerShell:

```powershell
$env:CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS = "1"
$env:CLOSER_TEST_DATABASE_URL = "postgres://closer:local-only-password@127.0.0.1:5432/closer_test"
bun run test:integration
```

The helper refuses Production (`NODE_ENV=production` or
`VERCEL_ENV=production`), remote hosts, and any database name other than
`closer_test`. If the explicit test URL or opt-in flag is absent, the guarded
command fails with a clear configuration error before opening a connection.
Unit tests that do not require database access remain available through the
default command.

### Worktrees

Worktrees do not share ignored `.env.local` files or `node_modules`. From a new
worktree, run `bun install --frozen-lockfile`, then copy the ignored local
environment file from the canonical checkout only when needed:

```powershell
Copy-Item ..\closer\apps\web\.env.local apps\web\.env.local
```

Never commit that file. For destructive tests, configure
`CLOSER_TEST_DATABASE_URL` explicitly in the test shell and verify it points to
the local `closer_test` database before running `bun run test:integration`.

### Production environment

Production values are configured through Vercel. Use
`apps/web/.env.production.example` as the checklist for the Neon `main` branch:

- `DATABASE_URL` is the pooled Production URL.
- `DATABASE_URL_UNPOOLED` is the direct Production URL for explicit schema operations.
- `REALTIME_DATABASE_URL` is the direct Production URL for `LISTEN/NOTIFY`.
- the existing Better Auth and Admin values are configured as documented.

**Pre-launch warning:** while Production data is disposable, an operator may
manually reset/clear `main` and run `bun run db:push`. A deploy never changes the
database. Once real user data exists, `db:push` against Production is
prohibited; establish a clean migration baseline before then and use only
reviewed, versioned migrations afterward.

### One-time clean-start runbook

Development first:

1. Confirm `apps/web/.env.local` points to Neon DEVELOPMENT.
2. Reset or clear the Development database manually.
3. Run `bun run db:push`.
4. Start `bun dev`.
5. Smoke test Closer and run relevant tests.

Production only after Development passes:

1. Confirm there is no Production data to preserve.
2. Confirm Vercel Production variables point to Neon `main`.
3. Reset or clear `main` manually.
4. Run `bun run db:push` explicitly against `main` from a trusted operator shell.
5. Deploy the application.
6. Bootstrap Admin with `bun run admin:bootstrap`.
7. Set `ADMIN_USER_ID` and redeploy if necessary.
8. Run the production smoke test.

Do not automate either reset or schema push.

### Future migration boundary

- **Current pre-launch:** Drizzle schema + manual `db:push` + disposable data.
- **Before real users:** create a clean migration baseline and re-enable
  migration-based releases.
- **After real users:** never use `db:push` to evolve Production; use only
  reviewed, versioned migrations.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@Closer/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Deployment

### Vercel Services

- Target: web + server
- Config: `vercel.json`
- Link the project first: bun run deploy:setup
- Local Vercel dev: bun run dev:vercel
- Sync preview env: bun run env:preview
- Sync production env: bun run env:production
- Dry-run check (no upload): bun run deploy:check
- Preview deploy: bun run deploy
- Production deploy: bun run deploy:prod
  Vercel Services share project environment variables, but deploys do not upload local `.env` files automatically. Link the project with `vercel link`, then run the env sync command before your first deploy (otherwise the deployment starts with no env vars), or pass one-off envs with `vercel deploy -e KEY=value`.
  Pass Vercel CLI flags to the env sync command directly, for example: `bun run env:production --scope your-team`.

### Preview runtime checklist

Before creating a Preview deployment, configure these Vercel Preview environment variables with deployment-safe values:

- `DATABASE_URL`: a pooled PostgreSQL connection string for the intended Preview database; never a localhost, loopback, or file URL.
- `DATABASE_URL_UNPOOLED`: a direct/unpooled PostgreSQL connection for explicit schema operations when needed.
- `BETTER_AUTH_SECRET`: at least 32 characters, scoped consistently with the Preview environment.
- `REALTIME_DATABASE_URL` (when `DATABASE_URL` is transaction-pooled): a direct, session-capable PostgreSQL URL for the server-side `LISTEN` connection. This is never sent to browsers or logged. If it is unset, the listener falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.

`BETTER_AUTH_URL` is intentionally not synchronized by `bun run env:preview`. On Vercel, Closer derives it from that deployment's `VERCEL_URL`, then uses that exact HTTPS origin for Better Auth's base URL and trusted-origin list. This supports each Preview URL without allowing arbitrary origins. For local development, keep `BETTER_AUTH_URL` set to the local app origin.

The Vercel build command is `cd ../.. && bun run --filter web build`. It only
builds the application: it does not run `db:migrate`, `db:push`, or any other
database mutation. Schema changes are explicit operator actions.

For the disposable pre-launch Production database only, use the guarded
`bun run db:push:production` workflow documented in the [Admin production
runbook](docs/admin/ADMIN-RUNBOOK.md). Keep the normal `bun run db:push`
command pointed at Development.

The `env:preview` helper warns if a local `.env` value looks like localhost. Treat that as a stop signal: configure the Preview value in Vercel (or use a deployment-safe env file) before deploying.

### Realtime invalidation

Closer uses one same-origin Server-Sent Events stream for each active Pair route tree. The stream carries only a version, Pair ID, and an invalidation type (`pair.changed`, `private.changed`, `together.changed`, or `pair.terminated`). It never carries answers, candidates, credentials, or other Pair content.

PostgreSQL `NOTIFY` publishes those invalidations across Vercel instances. Each warm Node process keeps at most one lazy `LISTEN closer_realtime` connection and fans matching notifications out to its local SSE clients. The SSE route reauthenticates and authorizes the current Participant before subscribing. If an instance or connection is recycled, the browser EventSource reconnects and the active TanStack Query projections are invalidated and fetched again.

For Preview debugging, inspect the EventStream request for `GET /api/pairs/:pairId/events` and the subsequent authorized projection GET. Do not log or paste database URLs, cookies, invitation tokens, answers, or candidate text. A missing direct PostgreSQL connection is a deployment blocker for cross-instance realtime; do not substitute an in-memory event bus.

For more details, see the guide on [Deploying to Vercel](https://www.better-t-stack.dev/docs/guides/vercel).

## Project Structure

```
Closer/
├── apps/
│   └── web/         # Fullstack application (Next.js)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Apply the current Drizzle schema to the configured database
- `bun run db:push:production`: Guarded, interactive one-time pre-launch Production schema push
- `bun run db:studio`: Open database studio UI
- `cd apps/web && bun run generate-pwa-assets`: Generate PWA assets
- `bun run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `bun run dev:vercel`: Run the Vercel Services dev environment locally
- `bun run env:preview`: Sync local env files to the Vercel preview environment
- `bun run env:production`: Sync local env files to the Vercel production environment
- `bun run deploy`: Create a Vercel preview deployment
- `bun run deploy:prod`: Deploy to Vercel production
- `bun run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading
