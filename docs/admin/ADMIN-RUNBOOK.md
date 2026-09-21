# Closer Admin V1 production runbook

Admin uses a dedicated Better Auth email/password account. It does not require
or create a Closer Participant. The Admin V1 implementation and repository
checks are complete; applying Production migrations and running the live smoke
test below remain manual operator release steps. This guide does not claim
that Production has been verified.

Use [apps/web/.env.example](../../apps/web/.env.example) as the environment-variable inventory.
Never commit credentials or put real database credentials in documentation.

## Production deployment checklist

1. Configure the normal Production runtime values: pooled `DATABASE_URL`,
   direct `DATABASE_URL_UNPOOLED` for migrations, `BETTER_AUTH_SECRET` (at
   least 32 characters), and `BETTER_AUTH_URL`. On
   Vercel, `BETTER_AUTH_URL` is derived from `VERCEL_URL` or
   `VERCEL_PROJECT_PRODUCTION_URL` when unset. Set it explicitly to the public
   canonical origin if using a custom domain. Set `REALTIME_DATABASE_URL` only
   when `DATABASE_URL` uses a transaction pooler or cannot support a persistent
   PostgreSQL `LISTEN` connection; it must be session-capable. Never use the
   Neon Development or TEST branch for Production.
2. In a trusted operator shell, prepare the temporary `ADMIN_BOOTSTRAP_EMAIL`
   and `ADMIN_BOOTSTRAP_PASSWORD`. Use a dedicated Admin email, not an existing
   consumer account. Do not leave these values in persistent Production
   configuration. The password must be 8–128 characters.
3. Before migrating, confirm that `DATABASE_URL_UNPOOLED` (or the explicit
   `DATABASE_URL` fallback) selected by the migration command targets the
   intended Production database. Run the repository command from the root:

   ```sh
   bun run db:migrate
   ```

   The Vercel Production build is also configured to run this same command
   before the web build. If you apply migrations manually first, the build
   checks the same Drizzle migration ledger. Never use `db:push` for deployment.

4. With the Production database and required auth environment available to the
   trusted operator process, run the bootstrap command manually from the root:

   ```sh
   bun run admin:bootstrap
   ```

   The command is not part of deployment. It creates only a missing dedicated
   account, prints its Better Auth user ID, and never prints the password.

5. Capture the printed ID and set it as `ADMIN_USER_ID` in Vercel Production.
   Without this value, no account is authorized for Admin routes.
6. Remove `ADMIN_BOOTSTRAP_PASSWORD` and `ADMIN_BOOTSTRAP_EMAIL` from the
   operator environment and any temporary secret store. Do not retain either
   as a persistent Production variable.
7. Redeploy or restart the web application so it receives the new
   `ADMIN_USER_ID` value.
8. Open `https://<your-production-host>/admin/login` manually. Sign in with the
   dedicated Admin account and complete the smoke test below.
9. Confirm the consumer UI has no Admin link.

The Admin scripts load the first existing file among `apps/web/.env.local`,
`apps/web/.env`, and root `.env`; shell-provided environment values take
precedence. When running a Production command locally, explicitly provide and
verify the intended Production target and auth values without printing or
logging credentials. Do not rely on an unrelated local `.env.local` value.

Bootstrap is a no-op only when the email already belongs to the configured
`ADMIN_USER_ID`. Any other existing-email case fails without changing or
promoting that account. If bootstrap fails because the email already exists,
choose a dedicated unused Admin email; do not repurpose a consumer account.

## Password recovery

1. In a trusted operator process connected to the intended Production
   database, set the temporary `ADMIN_RECOVERY_PASSWORD` (8–128 characters).
2. Run from the repository root:

   ```sh
   bun run admin:recover
   ```

3. Remove `ADMIN_RECOVERY_PASSWORD` from the process environment and any
   temporary secret store as soon as the command completes.

Recovery targets only `ADMIN_USER_ID`, changes that account's password using
Better Auth handling, and revokes its existing sessions. The command accepts no
user ID argument and cannot recover arbitrary accounts.

## Runtime configuration

- `DATABASE_URL` — pooled connection required for application queries.
- `DATABASE_URL_UNPOOLED` — direct connection used by migrations when configured.
- `BETTER_AUTH_SECRET` — required; use a unique secret of at least 32
  characters.
- `BETTER_AUTH_URL` — required resolved auth origin. Vercel values may supply a
  derived origin; configure it explicitly for a custom domain. Local development
  uses `http://localhost:3001`.
- `REALTIME_DATABASE_URL` — optional when `DATABASE_URL` or
  `DATABASE_URL_UNPOOLED` is already a direct, session-capable PostgreSQL
  connection; otherwise required for realtime `LISTEN`.
- `ADMIN_USER_ID` — optional for consumer-only operation; required to authorize
  Admin access.
- `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` — temporary bootstrap
  inputs; remove after provisioning.
- `ADMIN_RECOVERY_PASSWORD` — temporary recovery input; remove after recovery.

`NODE_ENV` is normally set by Next.js or the hosting platform. Vercel supplies
`VERCEL_ENV`, `VERCEL_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`. The internal
`SKIP_ENV_VALIDATION` is a local/testing validation bypass; leave it unset in
Production. `CLOSER_NEXT_DIST_DIR` is an optional build output override, while
`CLOSER_PERF_BASE_URL` and `CLOSER_PERF_REPEATS` are optional development
benchmark settings.

## Access behavior

Every `/admin/*` page and `/api/admin/*` endpoint authorizes independently.
Admin access is based only on an authenticated session matching
`ADMIN_USER_ID`; it does not resolve or require a Participant. Admin sign-in
requests use a database-backed limit of five requests per minute per IP, with
no global account lockout. Better Auth trusted-origin and CSRF protections
remain enabled.

## Manual Admin smoke test

### Authentication

- [ ] `/admin/login` loads; correct dedicated Admin credentials sign in and
      incorrect credentials fail.
- [ ] Logout works. A normal consumer account cannot access `/admin`, and the
      consumer UI contains no Admin link.
- [ ] Admin access works without Participant onboarding.

### Overview and Questions

- [ ] Overview shows Critical/Low inventory warnings, recent editorial
      activity, and a withdrawn-current warning when applicable.
- [ ] Create a Question; confirm it starts Inactive. Activate it and confirm
      the lifecycle activity is recorded.
- [ ] Create a new revision; confirm the ordinal increments, Question Activity
      is preserved, and the previous revision remains visible.
- [ ] Try an exact duplicate wording; confirm the warning appears but does not
      block creation or revision.
- [ ] Withdraw a revision; confirm a reason is required and the withdrawn
      marker appears. A Question whose current revision is withdrawn cannot be
      activated or reactivated.

### Analytics and privacy

- [ ] Operations, Private, and Together views load. Current revision is the
      default scope; historical selection is clearly labelled.
- [ ] A quality bucket below the five-Pair threshold displays **Insufficient
      data** without hidden counts or rates. No Pair, Participant, answer, or
      reply details appear.

### PRIVATE-01

- [ ] The candidate creator can Like/unlike and Skip an unresolved candidate;
      the other participant cannot see or control that candidate.
- [ ] Skip advances to the next eligible candidate or shows exhaustion, and a
      retry does not consume another Question.
- [ ] Ask still works, and the existing Reveal/answer flow still works.
