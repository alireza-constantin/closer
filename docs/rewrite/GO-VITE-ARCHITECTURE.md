# Go + Vite architecture and repository audit

Status: REWRITE-00 audit/specification only. This document records current
behavior and a proposed porting shape; it does not authorize implementation.

## 1. Current repository map

| Area               | Current location                                                                                        | Responsibility                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Web application    | `apps/web/`                                                                                             | Next.js 16 App Router, Server Components, Route Handlers, client React, TanStack Query |
| Shared UI          | `packages/ui/src/components/` and `packages/ui/src/styles/globals.css`                                  | shadcn-style primitives, Tailwind v4, Closer tokens                                    |
| Domain/persistence | `packages/db/src/closer.ts`                                                                             | transactional Closer operations and projections                                        |
| DB schema          | `packages/db/src/schema/closer.ts`                                                                      | Closer tables, enums, indexes, checks, composite FKs                                   |
| Auth schema        | `packages/db/src/schema/auth.ts`                                                                        | Better Auth user/session/account/verification/rate-limit tables                        |
| Auth package       | `packages/auth/src/index.ts`, `admin-provisioning.ts`                                                   | consumer anonymous/email auth, admin auth, bootstrap/recovery                          |
| HTTP contracts     | `apps/web/src/contracts/`                                                                               | Zod request and Admin response contracts                                               |
| HTTP adapters      | `apps/web/src/app/api/**/route.ts`                                                                      | auth, parse, call domain, map error, publish invalidation                              |
| Server modules     | `apps/web/src/server/modules/`                                                                          | thin server-side orchestration/read projections around the domain                      |
| Consumer features  | `apps/web/src/features/{auth,invite,pair,private-conversation,together-session}/`                       | reusable product UI and client mutations                                               |
| Shared product UI  | `apps/web/src/components/closer/`                                                                       | category, mode, shell, loading, forms, async actions                                   |
| Admin UI           | `apps/web/src/app/admin/` and `apps/web/src/server/modules/admin-questions/`                            | catalog, revision lifecycle, inventory, analytics                                      |
| Realtime           | `packages/db/src/realtime.ts`, `apps/web/src/app/api/pairs/[pairId]/events/route.ts`                    | PostgreSQL NOTIFY, one local listener, Pair-scoped SSE                                 |
| PWA                | `apps/web/src/app/manifest.ts`, `apps/web/public/favicon/`                                              | manifest and install icons; no service worker is currently visible in the repo         |
| Tests              | `packages/db/src/*.integration.test.ts`, `packages/db/src/realtime.test.ts`, `apps/web/src/**/*.test.*` | domain, route, UI, performance, confidentiality, realtime                              |
| Build/deploy       | root `package.json`, `vercel.json`, `apps/web/next.config.ts`                                           | Bun workspaces, Next build, Vercel deployment, guarded schema push                     |

The generated-stack metadata in `bts.jsonc` confirms the present choices:
Next, Bun, PostgreSQL, Drizzle, Better Auth, PWA addon, and Vercel.

## 2. Current ownership boundaries

The root `AGENTS.md`, `CONTEXT.md`, and ADR 004 establish the intended layering:

- `packages/db` is the authoritative transactional domain and persistence layer.
- `apps/web/src/app/api` is an HTTP adapter, not a second domain layer.
- `apps/web/src/server` owns current-actor resolution, HTTP concerns, and thin
  application services.
- Feature components must not import server code.
- `participant.id` owns domain data; an auth user ID is only the current auth
  mapping. This is the invariant in `docs/adr/001-domain-participant-identity.md`.

The Go port should preserve this shape directly: `internal/<domain>` owns
commands and projections, `internal/httpapi` adapts HTTP, and auth resolution
produces a Participant actor before domain authorization.

## 3. Domain service map

The public functions in `packages/db/src/closer.ts` are the current command and
query vocabulary. The named operation is the Go service boundary; helper
functions remain implementation details.

| Capability             | Current operations                                                                                                                | Main reference                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Participant            | `resolveOrCreateParticipant`, `getParticipantByAuthUserId`                                                                        | `packages/db/src/closer.ts:L210-L248`                |
| Question/Admin catalog | create Question, create revision, restore, duplicate search, activate, reactivate, deactivate, withdraw                           | `packages/db/src/closer.ts:L250-L647`                |
| Pair access/lifecycle  | list spaces, active access, complete access, status, terminate                                                                    | `packages/db/src/closer.ts:L657-L856`, `L1549-L1651` |
| Pair creation          | `createPairForParticipant`, `updateIntendedPersonName`                                                                            | `packages/db/src/closer.ts:L891-L982`                |
| Initial invite         | status, issue/reuse, replace, usable check, revoke, landing, redeem                                                               | `packages/db/src/closer.ts:L858-L1278`               |
| Guest replacement      | issue/revoke, landing, redeem                                                                                                     | `packages/db/src/closer.ts:L1280-L1547`              |
| Together               | start, playback, page, advance/skip, like, end                                                                                    | `packages/db/src/closer.ts:L1653-L2284`              |
| Private                | list eligible, start/resume, candidate select/Skip/Like, round projection/status, answer, Decline/retire, Reveal, reaction, reply | `packages/db/src/closer.ts:L2286-L4040`              |
| Former history         | `getFormerEraHistoryForParticipant`                                                                                               | `packages/db/src/closer.ts:L3516-L3827`              |
| Realtime               | `publishRealtimeEvent`, `getRealtimeBus`                                                                                          | `packages/db/src/realtime.ts:L1-L158`                |

The Go rewrite must not split these into independently authoritative Pair,
Private, Together, and history state machines. Their common lock boundary is a
Pair and its active membership era.

## 4. Database inventory and rewrite relevance

### Closer tables

| Table                        | Purpose                                                          | Key/constraints/indexes                                                                        | Go relevance                                                          |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `participant`                | Stable domain person mapped to current auth user                 | UUID PK; unique `auth_user_id`; display-name check                                             | Preserve unchanged; auth mapping remains separate                     |
| `pair`                       | Stable relationship and terminal lifecycle                       | UUID PK; unique `creation_request_id`; intended-name check                                     | Preserve; lock this row for Pair-scoped commands                      |
| `pair_membership`            | Slot occupancy and membership history                            | UUID PK; partial unique active slot and active participant per Pair; active participant index  | Preserve; maps logical slot to Participant and era history            |
| `pair_membership_era`        | Stable authorization/history boundary for two active memberships | UUID PK; one active era per Pair; Pair/started index; restrict FKs to memberships              | Preserve; it is the current executable ADR-005 choice                 |
| `initial_invite`             | Slot-2 bearer credential lifecycle                               | hash unique; Pair index; second-slot check                                                     | Preserve hash-only, 7-day expiry, single use                          |
| `rejoin_invite`              | Guest replacement credential                                     | hash unique; Pair and target indexes                                                           | Preserve separately from initial invite, 24-hour expiry               |
| `question`                   | Stable logical Question identity/current pointer                 | UUID PK; current revision composite FK; selection index                                        | Preserve; consumption uses this ID                                    |
| `question_revision`          | Immutable wording/eligibility snapshot                           | UUID PK; `(question_id, revision_number)` unique; selection indexes; content/fit checks        | Preserve; sqlc queries must always pin revision IDs                   |
| `question_lifecycle_event`   | Append-only editorial history                                    | UUID PK; Question/revision composite FK; occurred indexes; withdrawal reason check             | Preserve; no hard delete                                              |
| `private_conversation`       | One category sequence per Pair/era                               | unique `(pair_id, membership_era_id, category)`; Pair/category indexes                         | Preserve; immutable creator                                           |
| `private_question_candidate` | Creator-owned unresolved/asked/skipped/invalidated offer         | one unresolved per conversation; skip request unique; Conversation index; Question+revision FK | Highest-risk table; preserve state and idempotency fields             |
| `private_round`              | Asked Private occurrence                                         | unique conversation+number; Pair+conversation FK; client idempotency unique; retirement check  | Preserve; Pair lock on every mutable transition                       |
| `private_answer`             | One immutable answer per round/member                            | unique `(round_id, participant_id)`; body check                                                | Preserve; projection must hide other answer until mutual Reveal rules |
| `private_reveal_view`        | Viewer-local explicit Reveal fact                                | unique `(round_id, participant_id)`                                                            | Preserve; both views gate creator progression                         |
| `private_reaction`           | Viewer-owned post-reveal reaction                                | unique `(round_id, participant_id)`; enum                                                      | Preserve upsert/delete                                                |
| `private_reply`              | Viewer-owned post-reveal reply                                   | unique `(round_id, participant_id)`; body check                                                | Preserve upsert/delete                                                |
| `together_session`           | Bounded shared-device activity                                   | start request idempotency; Pair/session unique; era FK nullable for pre-claim                  | Preserve; pre-claim session has null era                              |
| `together_session_question`  | Persisted shown occurrence                                       | unique session+Question and session+position; advance request unique; current index            | Preserve; exact revision and logical consumption                      |

### Better Auth/admin tables

| Table          | Current role                                                 | Go decision                                                                                                                    |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `user`         | consumer and dedicated Admin identities; `is_anonymous` flag | Replace Better Auth ownership with a small explicit auth user table or a compatible migration; do not map Admin to Participant |
| `session`      | Better Auth cookie sessions, expiry, IP/UA                   | Replace with opaque random token, SHA-256 hash, expiry, revoke/delete                                                          |
| `account`      | credential account/password hash and provider metadata       | Replace with one credential table for V1 email/password; do not carry unused OAuth columns                                     |
| `verification` | Better Auth verification storage                             | Not required unless email verification/reset is adopted; decide before auth cutover                                            |
| `rate_limit`   | Better Auth database rate limiting                           | Keep or replace with a small keyed counter table for Admin sign-in five/IP/minute                                              |

### Enums and DB invariants

Enums in `packages/db/src/schema/closer.ts` are part of the contract:
relationship type, slot, category, relationship fit, mode fit, intensity,
lifecycle action, reaction value, candidate state, and round status.

Database-enforced core invariants include one active slot occupant, one active
membership per Participant/Pair, one active era, one unresolved candidate per
conversation, unique candidate Skip request, unique answers/reveal views/
reactions/replies, unique Round number, unique Together shown logical Question,
unique Together position/advance request, valid current-revision ownership,
content length/trim checks, and lifecycle withdrawal reason requirements.

Application-only invariants include actor authorization, current-era access,
candidate confidentiality, answer projection confidentiality, intensity ramp,
history visibility, terminal lifecycle semantics, and the rule that Ask/Skip
must freeze candidate Like.

The current schema is pre-launch and applied with manual `db:push`; no migration
history is authoritative. The Go rewrite should first snapshot this schema into
a reviewed baseline, then add only auth compatibility changes.

## 5. Transaction and locking map

| Operation                          | Current strategy                                                                                                           | Race prevented                                                         | Go equivalent                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pair creation                      | transaction; unique `creation_request_id`; `ON CONFLICT DO NOTHING`                                                        | retried create does not duplicate Pair                                 | `CreatePair(ctx, tx)` plus unique request ID                            |
| Initial invite issue/reuse/replace | Pair row lock; active sole-member check; unique token hash                                                                 | two browsers do not create two usable invitations; replace is explicit | `SELECT pair FOR UPDATE`, then revoke/insert                            |
| Initial claim                      | transaction; active Pair row lock; token lifecycle checks; advisory lock on unordered Participant pair; unique active slot | termination/claim ordering, duplicate active Pair, double claim        | same row lock plus `pg_advisory_xact_lock` or a deterministic lock row  |
| Together start                     | Pair row lock; start request unique; persisted first card                                                                  | duplicate Start, claim/start race                                      | one pgx tx with Pair lock and unique request                            |
| Together Next/Skip                 | mutable session and session row locks; advance request unique; current-card check                                          | concurrent Next/Skip and stale client                                  | lock Pair/session, update current card, insert next                     |
| Together Like/End                  | Pair/session row lock; current-card/session checks                                                                         | stale Like and post-end mutation                                       | same tx and terminal error                                              |
| Private start/category             | Pair lock; active-era check; unique Pair/era/category; active unresolved Round guard                                       | duplicate Conversation, cross-category open Round overlap              | Pair lock, then unique insert/select                                    |
| Private Ask                        | Pair, conversation, candidate locks; unresolved guard; candidate update + Round insert                                     | Ask/Skip race, duplicate Round, candidate leakage                      | one tx; update state conditionally; unique idempotency                  |
| Private Skip                       | same locks; unique `(conversation_id, skip_request_id)`; persisted next candidate                                          | retry consumes one logical Question only                               | one tx; return stored `skip_result_candidate_id`                        |
| Private first answer               | Pair lock; commit provisional Round atomically; one initiator unresolved check; unique answer                              | overlapping initiator work and answer/termination race                 | Pair lock through commit and answer insert                              |
| Private Decline                    | Pair lock; answer count/actor check; status update conditional                                                             | pass vs answer and duplicate pass                                      | update open row under Pair lock                                         |
| Reveal/reaction/reply              | Pair lock for mutable round; unique viewer records/upserts                                                                 | unauthorized or stale post-reveal writes                               | authorization projection inside tx, unique upsert                       |
| Replacement                        | Pair row lock; active era/membership checks; close old era; invalidate candidates; end Together; insert replacement era    | replacement vs Private/Together/termination                            | one tx from Pair lock through new era                                   |
| Termination                        | Pair row lock, active membership locks, one tx cleanup                                                                     | termination vs every Pair-scoped mutation; idempotent repeat           | same exact order; terminal Pair check first                             |
| Revision edit                      | Question row lock; expected current revision; unique per-question ordinal                                                  | stale Admin writer and pointer regression                              | `SELECT question FOR UPDATE`; compare expected ID; insert next revision |
| Withdrawal                         | Question/revision row lock; first withdrawal facts preserved; invalidate unresolved candidate                              | duplicate withdrawal and safety race                                   | revision lock plus candidate invalidation in same tx                    |

Do not replace row locks with application mutexes. The locks must work across
multiple Go processes and survive a VPS restart.

## 6. Auth audit and smallest safe Go model

### Current behavior

`packages/auth/src/index.ts` configures Better Auth with a Drizzle adapter,
trusted origin, secret, email/password, anonymous plugin, and Next cookie
plugin. `createAdminAuth()` uses a separate `/api/admin-auth` base path,
email/password with sign-up disabled, database rate limiting, and a custom
five requests/minute rule for `/sign-in/email`.

Consumer identity resolution is `session cookie -> Better Auth user.id ->
participant.auth_user_id -> Participant`, implemented in
`apps/web/src/server/auth/current-participant.ts:L6-L34`. Admin authorization is
independent of Participant onboarding and checks only session user ID against
`ADMIN_USER_ID` in `apps/web/src/server/auth/admin.ts:L10-L34`.

Anonymous registration/linking is not a domain copy operation. ADR 001 requires
the same Participant to survive any auth-user replacement. The current domain
code supports stable mapping and anonymous users; the rewrite must explicitly
implement the upgrade transaction rather than assume a Better Auth callback.

### Proposed Go V1 auth

Use the smallest explicit model:

```text
auth_user(id, email, display_name, anonymous, created_at, updated_at)
credential(auth_user_id, password_hash, provider, created_at, updated_at)
session(id, token_hash, auth_user_id, expires_at, created_at, ip, user_agent)
admin_identity(auth_user_id, configured marker or one-row binding)
rate_limit(key, window_started_at, count)
participant.auth_user_id -> auth_user.id
```

Design choices:

- Generate at least 32 random bytes for the bearer session token; store only
  SHA-256(token) and send the raw token in an HttpOnly, Secure,
  SameSite=Lax cookie. Use a narrower SameSite policy only if an actual invite
  flow requires it.
- Resolve the session on every request, reject expired/revoked rows, then map
  to Participant. Never accept auth or Participant IDs from JSON as ownership.
- Use Argon2id for email/password credentials. Preserve the current 8–128
  password policy and dedicated Admin account.
- Anonymous user registration must run in one transaction that locks the
  anonymous auth user and Participant mapping, creates or finds the registered
  auth user, repoints `participant.auth_user_id`, and deletes or retires the
  anonymous auth user only after the mapping is durable. A retry returns the
  same Participant; it never creates a second Participant or copies Pair data.
- Admin is a dedicated auth identity with no Participant row. Bootstrap is
  explicit and idempotent only for the configured email; recovery targets only
  the configured Admin and revokes all its sessions.
- Enforce five Admin sign-in attempts per IP per minute with a DB counter. Do
  not add global account lockout. Keep trusted-origin/CSRF checks for cookie
  mutations.

Required schema changes are limited to replacing Better Auth's implementation
tables or adding a compatibility layer. `participant`, `pair`, membership,
history, and question tables do not need ownership changes. Nice-to-have auth
changes (OAuth, email verification, password reset, multi-admin RBAC) are out
of scope until separately specified.

## 7. Participant, Pair, era, replacement, and termination parity

- Participant is created at onboarding before any Pair; display names are
  trimmed and 1–40 characters, duplicates are allowed.
- A Pair has exactly two logical slots. Creation occupies slot one, stores a
  contextual intended-person name, and does not issue an invite.
- Initial claim is an explicit bearer redemption. It clears the intended name,
  creates slot two and the first era, ends pre-claim Together sessions, and
  gives the claimant no pre-claim history.
- The intended name is never identity, uniqueness, authentication, or hidden
  claimant metadata. It remains contextual on an unclaimed terminated Pair.
- Guest replacement targets only an occupied anonymous slot with no active
  guest session. It creates a new Participant and membership in the same slot,
  closes the old membership/era, freezes its display name, invalidates old
  unresolved candidates, ends old Together sessions, revokes target invites,
  and begins a new era. The replacement sees no old-era content.
- Either active member may terminate. Termination is irreversible and
  idempotent; it ends memberships/era, revokes credentials, invalidates
  unresolved candidates, ends Together, and leaves old content read-only.
- History authorization is by membership ID/era, never by slot alone. Former
  names come from `ended_display_name`.

Canonical tests: `packages/db/src/closer.integration.test.ts`,
`rejoin-replacement.integration.test.ts`, and
`pair-termination.integration.test.ts`, especially the claim/replacement
serialization and former-era history cases listed in
[PARITY-CHECKLIST.md](./PARITY-CHECKLIST.md).

## 8. Private and Together implementation ownership

Private is a persistent `(Pair, active era, category)` Conversation. The creator
alone sees and controls an unresolved candidate. Ask creates a numbered Round
with the candidate's exact revision; Skip consumes the logical Question without
a Round; Like is a creator-only unresolved toggle. The non-creator receives
only `WAITING_FOR_CREATOR` and no candidate ID, Question ID, revision ID,
wording, or metadata.

Rounds have one immutable answer per Participant. Before both answers exist,
only the viewer's own answer is returned. Decline is available only before the
viewer has answered and is terminal. Both answers make Reveal-ready; each
viewer must persist a Reveal View. Reactions/replies require the viewer to have
viewed Reveal. There is no automatic progression. Candidate progression is
creator-only after both Reveal Views.

Together is a bounded shared-device Session with a persisted exact shown
occurrence. A session starts with Light preference; Next transitions drive the
Light/Medium/Deep ramp at 0–1/2–3/4+, Skip consumes but does not advance the
ramp, Like toggles only the current shown card, and End is idempotent. Selection
uses session seed, deterministic rank, 20-item pages, cursor buffering, and
fallback order. These buffering details are optimization; exact persisted
occurrence, no-repeat logical identity, category, intensity ramp, and terminal
behavior are product invariants.

The current algorithms are in `packages/db/src/closer.ts:L1653-L2284` and
`packages/db/src/together-playback.ts:L1-L52`.

## 9. Realtime target

Keep the current sequence:

```text
committed Go command
  -> pg_notify('closer_realtime', {version: 1, pairId, type})
  -> one persistent pgx LISTEN connection per API process
  -> in-process map[pairID]set[subscribers]
  -> Pair-scoped SSE
  -> client invalidates TanStack Query projections and refetches JSON
```

The current listener lazily starts on first subscriber, reconnects with
exponential backoff up to 30 seconds, sends a 20-second SSE heartbeat, and
cleans up on abort. `publishRealtimeEvent` deliberately does not fail an
already-committed command when notification publication fails. Preserve that
property and the metadata-only payload. Never send candidate, answer, reply,
reaction, invite token, or question content through SSE.

## 10. Frontend reuse audit

| Classification           | Current paths                                                                                                                                                                         | Port guidance                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A — nearly direct        | `apps/web/src/components/closer/*`, `packages/ui/src/components/*`, `packages/ui/src/styles/globals.css`, `apps/web/src/contracts/*`, feature components in `apps/web/src/features/*` | Keep React/Tailwind/React Hook Form/Zod and replace only Next imports and fetch helpers                                                  |
| B — routing/data changes | `apps/web/src/features/pair/components/*`, Private/Together components, `apps/web/src/components/providers/*`, `closer-query-keys.ts`, realtime provider                              | Keep projections and UI; replace `next/navigation`, Server Component props, and direct `/api` calls with React Router + typed API client |
| C — rewrite              | `apps/web/src/app/**/page.tsx`, `layout.tsx`, `loading.tsx`, `apps/web/src/server/auth/*`, `apps/web/src/server/http/*`, `apps/web/src/server/modules/*`, Next auth route adapters    | These are Next-specific entry points or server-only adapters; preserve behavior, not code shape                                          |
| D — obsolete             | `next.config.ts`, `vercel.json` Next service wiring, Next font/metadata wrappers, Server Component loading boundaries, Better Auth Next cookie adapter                                | Replace with Vite build/PWA config, Go auth endpoints, and React Router pending UI                                                       |

Preserve the Closer visual language and shared mappings. The canonical tokens
are in `packages/ui/src/styles/globals.css`; category and mode semantics are in
`apps/web/src/components/closer/category.tsx` and `mode-badge.tsx`. Do not
recreate these as generic shadcn defaults.

The current frontend has an important safety property: performance tests verify
that prefetching is read-only and candidate/round content is not fabricated in
the browser. Port those tests as client contract tests.

## 11. Vite route shape

Use React Router for the current user-facing URLs:

```text
/                         participant-aware landing
/login                    consumer sign-in
/onboarding               participant creation
/create                   Pair creation
/dashboard                legacy compatibility/redirect target
/join/:token              initial invite landing
/rejoin/:token            rejoin landing
/pair/:pairId             Pair Home
/pair/:pairId/invite      Connect/initial invite
/pair/:pairId/rejoin      guest replacement controls
/pair/:pairId/private     Private category hub
/pair/:pairId/private/conversation/:conversationId
/pair/:pairId/private/round/:roundId
/pair/:pairId/together    Together picker
/pair/:pairId/together/:relationship  picker compatibility route
/pair/:pairId/together/:sessionId    Together playback
/pair/:pairId/history     former/current history
/admin/login              dedicated Admin login
/admin                    Admin overview
/admin/questions          catalog workspace
/admin/questions/new      create Question
/admin/questions/:id      detail/revisions/analytics
```

The client may redirect after a safe `GET /api/me`/`GET /api/participant`
projection, but protected data must never be preloaded before the API proves
the actor. Public invite/rejoin landing endpoints may expose only their safe
contextual projections. Authorization remains server-side and unauthorized
Pair, Private, Together, and history resources should continue to collapse to
not-found where the current adapters do.

## 12. Proposed Go package layout

```text
apps/api/
  cmd/server/main.go
  internal/auth/              # session, credentials, actor resolution, admin
  internal/participant/       # onboarding and auth mapping
  internal/pair/              # Pair, membership, eras, termination
  internal/invite/            # initial and rejoin credentials
  internal/question/          # revisions and deterministic selection helpers
  internal/private/           # conversations, candidates, rounds, history
  internal/together/          # sessions and playback
  internal/history/           # former-era projections
  internal/admin/             # catalog, inventory, analytics
  internal/realtime/          # NOTIFY listener, registry, SSE
  internal/httpapi/           # routers, middleware, DTOs, error mapping
  internal/postgres/          # pool, transactions, lock helpers
  db/queries/                 # sqlc query files
  db/migrations/              # reviewed baseline and later migrations
  sqlc.yaml
```

Use `pgxpool`, `pgx`, `sqlc`, `chi`, and `slog`. Domain packages may depend on
small postgres/queries interfaces; HTTP must not own SQL. Keep transaction
boundaries in domain command functions so a reviewer can see the Pair lock and
all mutations together.

## 13. SQLC and PGX design

Turn straightforward projections and existence checks into sqlc queries. Keep
high-risk commands as handwritten transaction orchestration calling small
sqlc queries:

```text
tx := db.Begin(ctx)
pair := q.WithTx(tx).LockActivePair(ctx, pairID)          // FOR UPDATE
actor := q.WithTx(tx).RequireActiveMembership(ctx, ...)
validate era / state / actor / idempotency
mutate rows with conditional WHERE clauses
use unique conflicts as convergence checks
commit
publish metadata invalidation after commit
```

Recommended sqlc groups:

- auth: session lookup, revoke, credential lookup, rate-limit increment;
- pair: active access, Pair lock, membership/era lock, status/history roots;
- invite: token-hash lookup, usable-state projection, issue/revoke/redeem;
- question: current revision, next ordinal, expected pointer, lifecycle;
- private: candidate/round/answer/reveal projections and conditional updates;
- together: current card, deterministic page, advance/like/end;
- admin: list/detail, lifecycle activity, aggregate analytics, inventory.

Do not generate a generic ORM repository per table. Small helpers are justified
for token hashing, deterministic ranking, error mapping, and lock acquisition.

## 14. Error model

Preserve stable domain codes, even if Go names are typed constants:

```text
UNAUTHENTICATED / UNAUTHORIZED
FORBIDDEN
DISPLAY_NAME_INVALID
INTENDED_PERSON_NAME_INVALID
RELATIONSHIP_TYPE_INVALID
PAIR_NOT_FOUND
PAIR_TERMINATED
PAIR_ALREADY_CLAIMED
PAIR_NOT_READY
INVITE_UNAVAILABLE
REJOIN_UNAVAILABLE
CONVERSATION_NOT_FOUND
QUESTION_UNAVAILABLE
QUESTION_REVISION_CONFLICT
QUESTION_STATE_CONFLICT
QUESTION_REVISION_WITHDRAWN
QUESTION_WITHDRAWAL_REASON_REQUIRED
ANSWER_INVALID / ANSWER_IMMUTABLE
REPLY_INVALID
REACTION_INVALID
REVEAL_NOT_READY
TOGETHER_SESSION_NOT_FOUND / TOGETHER_SESSION_ENDED / TOGETHER_SESSION_EXHAUSTED
TOGETHER_ACTION_INVALID
```

Map authorization failures to 401/403 or resource-specific 404 according to
the current adapter, state conflicts to 409, malformed input to 400, and never
return raw PostgreSQL errors.

## 15. Suitability verdict

Go + Vite remains a good fit because the repo's hard requirements are explicit
transactions, row locks, PostgreSQL constraints, small JSON projections, and a
persistent SSE listener—not Next-specific server rendering. Adjustments:

- keep a single deployable Go API, not microservices;
- keep PostgreSQL as the only coordination store; Redis is not justified;
- use Caddy for static assets and `/api`/`/events` proxying;
- retain React Query, RHF, Zod, Tailwind, shadcn primitives, and the current
  design tokens;
- replace Better Auth with a narrow compatibility-minded Go auth layer;
- use reviewed migrations before any real-user deployment.
