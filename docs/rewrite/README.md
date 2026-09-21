# Closer Go + Vite rewrite audit

REWRITE-00 is complete as a documentation-only audit. The current Next/Bun
implementation remains the executable specification. No Go code, Vite code,
schema mutation, runtime change, or application commit is part of this work.

Read the documents in this order:

1. [GO-VITE-ARCHITECTURE.md](./GO-VITE-ARCHITECTURE.md) — current map, auth,
   domain, persistence, realtime, frontend reuse, and target structure.
2. [API-CONTRACTS.md](./API-CONTRACTS.md) — current HTTP surface and the
   proposed explicit Go API.
3. [PARITY-CHECKLIST.md](./PARITY-CHECKLIST.md) — behavior, locking,
   confidentiality, analytics, realtime, and canonical tests.
4. [REWRITE-PLAN.md](./REWRITE-PLAN.md) — ticket sequence, parity harness,
   cutover, VPS deployment, risks, and checkpoints.

## Executive decision

Go + Vite is a good fit for Closer, with one non-negotiable constraint: the Go
API must be a persistent, stateful process with PostgreSQL transactions and a
session-capable `LISTEN` connection. A stateless/serverless deployment would
fight the current realtime and locking model. React + Vite is appropriate for
the client, but it must preserve server-derived projections and route guards;
it must not move authorization or candidate confidentiality into the browser.

The highest-risk phase is Private, especially creator-only unresolved
candidate projections, Ask/Skip races, logical-question consumption, answer
confidentiality, Decline, and both-view Reveal progression. Pair termination,
guest replacement, and auth identity linking are the next highest-risk seams.

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

## Contradictions and supersessions

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
4. `apps/web/src/app/api/pairs/[pairId]/private-rounds/route.ts` returns the
   conversation list despite its `/private-rounds` name. The rewrite should
   expose one canonical resource path and keep a compatibility alias only if
   the parity client needs it.

## Evidence boundary

The audit used the root glossary and ADRs, Admin specifications and runbook,
all current route handlers, the DB schema, the domain service, auth setup,
realtime implementation, frontend features, and integration/unit tests. The
most authoritative implementation references are listed inline in the other
documents with file and line spans.

## Open decisions requiring user input

The audit can proceed without blocking on these, but decide them before the
corresponding implementation ticket:

- whether Go auth migrates Better Auth tables in place or uses a short-lived
  compatibility bridge;
- whether email verification/password reset are in the rewrite launch scope;
- whether the VPS uses local PostgreSQL or an external managed PostgreSQL
  service, and the required backup retention;
- the rollback retention window for keeping the legacy Next app after cutover;
- whether `/dashboard` remains a compatibility route or is removed after the
  Vite route map is proven;
- whether current pre-launch disposable data is intentionally discarded when
  the reviewed Go migration baseline is installed.
