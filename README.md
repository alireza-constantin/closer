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

Normal development uses a dedicated Neon Development branch. Docker remains an
optional offline/local fallback; it is not required when the Neon variables are
configured.

1. Create or select a Neon Development branch. Never use Production branch
   credentials in local development.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and set:
   - `DATABASE_URL` to the pooled Development URL for normal app queries.
   - `DATABASE_URL_UNPOOLED` to the direct Development URL for migrations.
   - `REALTIME_DATABASE_URL` to the direct Development URL for `LISTEN/NOTIFY`.
   - the required auth and admin values with non-production local values.
3. Apply tracked migrations to the Development branch:

```bash
bun run db:migrate
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

### Integration-test database

Create a separate Neon TEST branch. Do not point tests at Production or share a
manually used Development database: the integration tests create and delete
fixtures. Copy the test-only values to `apps/web/.env.test.local` and set
`TEST_DATABASE_URL` to a direct/session-capable URL for that TEST branch. Keep
`DATABASE_URL` pointed at Development in `.env.local`; the test bootstrap
requires `TEST_DATABASE_URL` and maps it only inside the test process.

Initialize the TEST branch with the same tracked migrations before running
integration tests:

```bash
# macOS/Linux/Git Bash
NODE_ENV=test bun run db:migrate

# PowerShell
$env:NODE_ENV = "test"; bun run db:migrate
```

The test helper refuses to run without `TEST_DATABASE_URL` and refuses to use
the same value as `DATABASE_URL`.

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
- `DATABASE_URL_UNPOOLED`: a direct/unpooled PostgreSQL connection for the migration command when configured.
- `BETTER_AUTH_SECRET`: at least 32 characters, scoped consistently with the Preview environment.
- `REALTIME_DATABASE_URL` (when `DATABASE_URL` is transaction-pooled): a direct, session-capable PostgreSQL URL for the server-side `LISTEN` connection. This is never sent to browsers or logged. If it is unset, the listener falls back to `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.

`BETTER_AUTH_URL` is intentionally not synchronized by `bun run env:preview`. On Vercel, Closer derives it from that deployment's `VERCEL_URL`, then uses that exact HTTPS origin for Better Auth's base URL and trusted-origin list. This supports each Preview URL without allowing arbitrary origins. For local development, keep `BETTER_AUTH_URL` set to the local app origin.

The current Vercel build applies Drizzle migrations automatically only for Production. Before a Preview needs a newly committed schema migration, apply `bun run db:migrate` once against its intended Preview database from a trusted environment. The PostgreSQL role must be allowed to create the `pgcrypto` extension because migration `0015_together_question_page_hashing.sql` uses `CREATE EXTENSION IF NOT EXISTS pgcrypto`.

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
- `bun run db:push`: Push schema changes to a database (not used for Neon branch setup or deployment)
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `cd apps/web && bun run generate-pwa-assets`: Generate PWA assets
- `bun run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `bun run dev:vercel`: Run the Vercel Services dev environment locally
- `bun run env:preview`: Sync local env files to the Vercel preview environment
- `bun run env:production`: Sync local env files to the Vercel production environment
- `bun run deploy`: Create a Vercel preview deployment
- `bun run deploy:prod`: Deploy to Vercel production
- `bun run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading
