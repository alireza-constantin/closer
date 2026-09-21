# Closer Go + Vite rewrite architecture

**Status: REWRITE-01 architecture freeze.** The final target is React, Vite,
TypeScript, React Router, TanStack Query, React Hook Form, Zod, Tailwind, and
the existing Closer visual system on the frontend; Go, PostgreSQL, HTTP JSON,
SSE, and PostgreSQL `LISTEN`/`NOTIFY` on the backend. **Purpose-built Closer
authentication in Go is frozen. Better Auth is not part of the final runtime.**

This is a documentation-only decision record. The current Next/TypeScript app
and its tests remain the behavioral reference until cutover. It does not
authorize Go or Vite implementation, schema mutation, dependency changes,
deployment, or a database operation.

Read the documents in this order:

1. [GO-VITE-ARCHITECTURE.md](./GO-VITE-ARCHITECTURE.md) — the frozen technical
   decisions, including package/dependency direction and the supporting
   repository audit.
2. [API-CONTRACTS.md](./API-CONTRACTS.md) — the versioned HTTP contract and
   its error, projection, and client-validation rules.
3. [PARITY-CHECKLIST.md](./PARITY-CHECKLIST.md) — non-negotiable behavioral,
   concurrency, confidentiality, auth, realtime, and PWA cutover gates.
4. [REWRITE-PLAN.md](./REWRITE-PLAN.md) — dependency order, exact early-ticket
   acceptance criteria, transition layout, and cutover boundaries.

## Frozen executive decision

Go + Vite is the rewrite target. The Go API is a persistent, stateful process
with PostgreSQL transactions and a session-capable `LISTEN` connection; it is
not a serverless port. React + Vite preserves server-derived projections and
route guards; it does not move authorization or candidate confidentiality into
the browser. `chi` over `net/http`, `pgx`/`pgxpool`, `sqlc` for stable queries,
and direct `pgx` only for genuinely dynamic reporting are frozen choices.

The Go structure is feature-oriented rather than template-layered: HTTP is a
transport-only adapter, feature modules own application operations and
consumer-owned ports, and `internal/postgres/<feature>` contains the concrete
adapters. sqlc source remains in `apps/api/db/queries`, while generated code is
an `internal/postgres/sqlc` persistence detail. Domain modules do not import
HTTP, pgx, or generated sqlc models.

The highest-risk phase is Private, especially creator-only unresolved
candidate projections, Ask/Skip races, logical-question consumption, answer
confidentiality, Decline, and both-view Reveal progression. Pair termination,
guest replacement, and auth identity linking are the next highest-risk seams.

## Identity and schema ownership amendment

The new Go runtime owns executable schema and UUID authentication identity:
`auth_user.id` is UUID, and each Participant has one unique
`participant.auth_user_id UUID` foreign key to it with restricted deletion.
Legacy Better Auth text IDs remain only in the Next reference. No identity
mapping or compatibility bridge exists, and the two runtimes never share
physical auth/Participant rows; parity compares observable behavior. Drizzle
remains the semantic reference for Closer domain concepts, while Go owns the
ordered `apps/api/db/schema/` pre-launch bootstrap. A proper versioned migration
baseline must be established before real production users exist.

## Portability boundary

The same domain code must run against local PostgreSQL in development, Neon in
current production, and PostgreSQL bound to `127.0.0.1` on the future VPS.
`DATABASE_URL` is the normal-query pool URL. `REALTIME_DATABASE_URL` is a
session-capable direct URL for `LISTEN`; during transition only,
`DATABASE_URL_UNPOOLED` remains its fallback. No Neon API or hostname belongs
in domain or persistence code.

Production serves the static Vite build and `/api/v1` from one origin. Caddy
exposes HTTP/HTTPS only; PostgreSQL is not public, uses an application-specific
role, and has off-server backups. Vercel may host the transition only when it
can serve deep-link fallbacks and proxy the API without changing this contract.

## Important repository findings

- The real domain boundary is `packages/db/src/closer.ts`, not the Next route
  handlers. It owns Pair locks, membership eras, idempotency, selection,
  Private, Together, history, and Admin Question transitions.
- `packages/db/src/schema/closer.ts` already encodes many race-safety rules with
  partial unique indexes and composite foreign keys.
- `participant.id` is intentionally distinct from the Better Auth user ID.
  Pair and history ownership must remain attached to Participant IDs.
- Realtime is a metadata-only invalidation channel: `pair.changed`,
  `private.changed`, `together.changed`, and `pair.terminated`.
- The PWA manifest is stale: `apps/web/src/app/manifest.ts` uses
  `start_url: "/new"`, but the current route is `/create`. This must be
  resolved during WEB-01 rather than copied blindly.
- The current pre-launch workflow is Drizzle schema plus manual `db:push`.
  The rewrite should create a reviewed migration baseline before any real-user
  cutover; it must never carry `db:push` into the post-launch workflow.

## Resolved supersessions

1. ADR 003 contains an explicitly labelled historical Shared Open section whose
   creator/shared-candidate rules are superseded by the 2026-09-20 amendment.
   The active rule is creator-only candidate control; the older text must not be
   ported as behavior.
2. ADR 005 says an era need not be a dedicated table, while the implementation
   uses `pair_membership_era`. This is compatible: the ADR permits an explicit
   stable configuration identity, and the table is now the executable choice.
3. The root README and `bts.jsonc` describe a Vercel/Next generated stack. That
   is accurate for the current app but is deployment history, not a constraint
   on the proposed VPS target.
4. ADR 001 correctly preserves a stable Participant through Better Auth's old
   identity-linking behavior. Go has no Better Auth identity replacement: an
   anonymous user attaches credentials to the **same UUID `auth_user`**, so the
   Participant and Pair ownership remain unchanged without an identity map.
5. `apps/web/src/app/api/pairs/[pairId]/private-rounds/route.ts` returns the
   conversation list despite its name. The Go API uses canonical
   `/api/v1/pairs/:pairId/private-conversations`; there is no new ambiguous
   alias unless a measured transition client requires one.

## Evidence boundary

The audit used the root glossary and ADRs, Admin specifications and runbook,
all current route handlers, the DB schema, the domain service, auth setup,
realtime implementation, frontend features, and integration/unit tests. The
most authoritative implementation references are listed inline in the other
documents with file and line spans.

## Closed decisions

- Pre-launch data is disposable. The reviewed Go-independent baseline replaces
  Better Auth tables at `CUTOVER-01`; there is no in-place provider bridge.
- Consumer email verification and email-delivered password reset are deferred.
  They are neither implied by login nor silently simulated. Privileged Admin
  recovery remains an operator-only command that resets only an Admin user and
  revokes that user's sessions.
- `admin_user`, not `ADMIN_USER_ID`, is the final authorization record. The
  environment variable is transition-only and is removed with Better Auth.
- `/dashboard` is a temporary client redirect to `/`; it is removed only at
  legacy removal after deep-link parity proves the new route map.
- The legacy Next app remains read-only reference and rollback artifact until
  cutover parity, rollback rehearsal, and the agreed retention window are
  complete. This task deliberately does not set an operational retention date.
