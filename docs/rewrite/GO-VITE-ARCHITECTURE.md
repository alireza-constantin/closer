# Go + Vite architecture and repository audit

Status: **REWRITE-01 architecture freeze.** Sections 1–15 are the supporting
REWRITE-00 audit. The decisions in section 0 are authoritative where an older
audit statement says “proposed” or differs. This document does not authorize
implementation.

## 0. Frozen architecture decisions

### 0.1 HTTP, package direction, and database access

Use `chi` on the Go standard library `net/http`; do not add another web
framework. `chi` supplies readable nested routes and path parameters while all
HTTP, streaming, context, and shutdown behavior remains standard-library
behavior. Use structured `slog` logging, request IDs, recovery, request-size
limits, explicit timeouts, and a small ordered middleware chain.

```text
apps/api/
  cmd/server/main.go                 process wiring only
  internal/config/                   parsed, validated runtime configuration
  internal/httpapi/                  chi routes, middleware, JSON DTOs/errors
  internal/auth/                     auth user, credential, session, admin actor
  internal/participant/              onboarding and participant resolution
  internal/pair/                     Pair, membership, era, termination
  internal/invite/                   initial and rejoin credential lifecycles
  internal/question/                 revision lifecycle and selection primitives
  internal/together/                 Session commands and projections
  internal/private/                  Conversation, candidate, Round commands
  internal/history/                  former/current authorized projections
  internal/admin/                    catalog, inventory, analytics
  internal/realtime/                 NOTIFY listener, registry, SSE handler
  internal/postgres/                 pool, transaction and adapter infrastructure
    sqlc/                             generated code; never hand edited
  db/schema/                         ordered pre-launch Go schema bootstrap DDL
    001_auth.sql
    002_participant_pair.sql
  db/queries/                        sqlc SQL source
  db/migrations/                     future reviewed production baseline/migrations
  sqlc.yaml
```

`httpapi` authenticates, validates HTTP input, calls one service, maps a
typed result/error, and serializes a DTO. It owns no Pair, Private, auth, or
authorization transition. Domain services own authorization that depends on
domain state, transaction scope, row locking, validation, idempotency, and
the returned application projection. They depend only on normal Go types and
small, consumer-owned ports; they never import `httpapi`, `postgres`, `pgx`,
or generated sqlc packages. `realtime` accepts already-committed invalidation
metadata and has no domain authority.

Generated sqlc rows stay inside `internal/postgres` adapters. HTTP DTOs are
hand-authored JSON types in `internal/httpapi`, domain/application models are
feature-owned normal Go types, and database rows are persistence-only types.
No type crosses all three layers merely for convenience.

### 0.1a Final package structure and dependency direction

This is the target tree, not authorization to create placeholders. `GO-01`
creates only the process/config/HTTP foundation it needs; the feature and
feature-specific Postgres directories appear only in their owning ticket.
`SOURCE`, `GENERATED`, `TRANSPORT`, `DOMAIN/APPLICATION`, and
`INFRASTRUCTURE` describe responsibility, not a generic layer framework.

```text
apps/api/
  go.mod                                      # SOURCE: module definition
  sqlc.yaml                                   # SOURCE: generator configuration
  cmd/
    server/
      main.go                                 # SOURCE: process wiring only
  db/
    queries/                                  # SOURCE: sqlc SQL by feature
      auth.sql
      participant.sql
      pair.sql
      invite.sql
      question.sql
      together.sql
      private.sql
      history.sql
      admin.sql
    migrations/                               # SOURCE: reviewed SQL at CUTOVER-01
  internal/
    config/                                   # INFRASTRUCTURE: typed env configuration
    httpapi/                                  # TRANSPORT: never domain behavior
      router.go
      middleware/
      auth/                                   # feature route/handler/DTO files as needed
      participant/
      pair/
      invite/
      question/
      together/
      private/
      history/
      admin/
    auth/                                     # DOMAIN/APPLICATION: identity, sessions, Admin actor
    participant/                              # DOMAIN/APPLICATION: onboarding/profile resolution
    pair/                                     # DOMAIN/APPLICATION: Pair, membership, era, termination
    invite/                                   # DOMAIN/APPLICATION: initial/rejoin credentials and claim
    question/                                 # DOMAIN/APPLICATION: revisions, lifecycle, eligibility
    together/                                 # DOMAIN/APPLICATION: Session and occurrence transitions
    private/                                  # DOMAIN/APPLICATION: confidential Conversation/Round transitions
    history/                                  # DOMAIN/APPLICATION: authorized read projections only
    admin/                                    # DOMAIN/APPLICATION: editorial/read coordination only
    realtime/                                 # INFRASTRUCTURE: Publisher contract and fanout implementation
    postgres/                                 # INFRASTRUCTURE: never a domain repository dump
      pool.go
      tx.go
      errors.go
      listen.go                               # only if listener setup belongs here
      sqlc/                                   # GENERATED: package-private persistence detail
      auth/                                   # adapters, created only when a feature needs one
      participant/
      pair/
      invite/
      question/
      together/
      private/
      history/
      admin/
```

`cmd/server/main.go` loads validated config; constructs logger, pool, concrete
Postgres adapters, feature modules, realtime publisher/fanout, and HTTP router;
then runs graceful shutdown. It contains no SQL, handler, auth, or domain rule.
If this becomes unwieldy after real wiring exists, a bootstrap module may be
introduced then—not before.

`internal/httpapi` is transport-organized: `router.go`, narrowly scoped
middleware, then feature folders containing only routes, handlers, and DTOs.
Handlers resolve an actor, parse/validate path/query/body, call an application
operation, map a typed error, and serialize. HTTP-only security checks may be
middleware; no handler obtains a row lock, writes SQL, starts a transaction,
selects a Question, or decides a domain authorization/lifecycle rule.

Feature packages are the application modules. They use only files justified by
their operation—typically `service.go`, feature models/commands/results, a
small `port.go` when a seam is real, and `errors.go` only when errors are not
already naturally local. They do not receive boilerplate `repository`,
`service`, `manager`, `provider`, or `model` layers by default.

`internal/postgres` root owns pool lifecycle, transaction primitive, low-level
database error classification, and optionally direct listener setup. It does
not own a generic repository framework or become the home for all domain SQL.
Feature-specific concrete adapters live below it, for example
`internal/postgres/private`, and translate between feature ports/models and
sqlc/pgx. The adapters may import their feature package to implement a
consumer-owned port; the feature package never imports back.

The allowed graph is:

```text
cmd/server
  -> config, postgres infrastructure/adapters, realtime implementation, feature modules, httpapi
httpapi
  -> feature modules, auth actor middleware, realtime SSE transport adapter
feature module
  -> its own models/errors/consumer-owned ports, realtime Publisher/Event contract, context, standard library
postgres/<feature> adapter
  -> postgres root, postgres/sqlc generated code, feature port/model package
realtime implementation
  -> postgres listener/publisher infrastructure, realtime Publisher/Event contract
```

The following directions are forbidden:

```text
auth|participant|pair|invite|question|together|private|history -> httpapi, chi, net/http, JSON, cookies, SSE wire code
auth|participant|pair|invite|question|together|private|history -> postgres, pgx, postgres/sqlc generated types
postgres or postgres/<feature> -> httpapi
private|together|pair|question|invite|history -> admin
feature package -> another feature's concrete service implementation
HTTP DTO <-> domain/application model <-> sqlc row as a shared universal type
```

`admin` is deliberately one-way: it may coordinate approved Question editorial
operations and cross-domain read/query dependencies for catalog, coverage,
inventory, and analytics; no core domain depends on Admin. `history` is a
read/projection module, not a second lifecycle service: its port reads the
membership/era, former-name, Reveal, Private, and Together facts needed to
produce an already-authorized viewer-relative projection. `history` owns no
state mutation. `realtime` offers a small framework-free `Publisher`/`Event`
seam—the one deliberate cross-domain infrastructure contract. Domain
operations know only a Pair identifier and event type, not NOTIFY payloads,
subscriber maps, heartbeats, EventSource, flushing, or SSE formatting. The SSE
handler belongs under `httpapi` and adapts the realtime fanout to HTTP.

### 0.1b Ports, transactions, errors, context, and logging

Interfaces are exceptional, small, and defined by their consumer feature. A
feature uses one only when it needs a real seam: a persistence adapter, the
post-commit `realtime.Publisher`, a deterministic clock/random source where
the operation actually varies, or a focused cross-domain fact provider. One
concrete dependency is not enough reason to create an interface. There is no
global `Repository`, `Service`, `Manager`, `Provider`, `common`, `shared`,
`core`, `utils`, or `helpers` package. Cohesive helpers stay with their owner,
such as email/token handling in auth or invite.

For a high-risk operation, the feature service owns visible orchestration. Its
consumer-owned transaction port is shaped for that operation, for example a
Private store can expose `WithinTx(ctx, func(PrivateStore) error) error`; the
callback captures the result while the service locks, validates, applies
idempotency, and orders mutations. Its Postgres adapter begins/commits/rolls
back the single `pgx.Tx` and provides transaction-bound sqlc queries internally.
No repository begins an unrelated hidden transaction, and no pgx/sqlc value
escapes to the service. The same pattern applies to Invite claim, Pair
termination, Together transitions, and Question revision/withdrawal. An Invite
claim service owns credential redemption orchestration; its focused port
performs Pair membership/era work atomically without making Invite duplicate
Pair policy or importing a concrete Pair service. Pair termination similarly
uses its own focused store to end dependent activity without importing Private
or Together.

The default mutation ordering is explicit: begin -> lock -> validate -> mutate
-> commit -> publish metadata invalidation -> return. Publication is after a
successful application commit. PostgreSQL `NOTIFY` may be issued within that
same transaction only when its delivery is guaranteed to occur after commit;
the service still treats failure to publish after a committed state as
non-rollbackable and clients reconcile by refetching.

Feature packages define meaningful errors such as `private.ErrCandidateResolved`,
`pair.ErrTerminated`, or `question.ErrStaleRevision`. `postgres` maps driver
failures into lower-level categories; `httpapi` alone maps typed feature errors
to HTTP status and stable API code. `context.Context` carries request lifetime,
cancellation, and deadline only. Middleware may place a type-safe resolved
actor in request context, but services receive actor identity explicitly in a
command whenever authorization depends on it. Configuration is typed in
`internal/config`; no business package calls `os.Getenv`. Logging uses
structured infrastructure logging, excludes raw credentials/tokens/invites and
Private answer content, and is injected only where an operational need is real.

Use `pgxpool` for normal queries, an explicit `pgx.Tx` for every multi-step
command, and one dedicated long-lived `pgx.Conn` per API process for `LISTEN`.
`DATABASE_URL` configures the normal pool and can use a Neon pooler. A
production `REALTIME_DATABASE_URL` must be a direct/session-capable URL.
`DATABASE_URL_UNPOOLED` is only a transition fallback when the realtime URL is
unset; new Go deployment configuration must set `REALTIME_DATABASE_URL`.
Local PostgreSQL may use `DATABASE_URL` for both. Start only after pool `Ping`
and, when realtime is enabled, direct-listener connection validation succeed.
Defaults are conservative: pool max 10, min 0, acquire timeout 5 seconds,
connect timeout 5 seconds, command timeout 10 seconds, and a separately
bounded 30-second streaming write deadline. Configuration, not code, adjusts
them. Shutdown first stops accepting requests, closes SSE subscribers, waits
up to 10 seconds for requests, then closes listener and pool.

### 0.2 sqlc and direct-pgx boundary

`sqlc` is required for stable row shapes: auth/session/credential lookups;
Pair, membership, and era access/locks; invite token lifecycle; Question and
revision lifecycle; deterministic selection inputs; Private and Together
command/projection queries; and ordinary Admin catalog/inventory reads. It is
preferred for all fixed SQL with a stable result shape, especially every
`FOR UPDATE` query.

Direct parameterized `pgx` is acceptable only in a named repository helper for
dynamic Admin analytics/reporting with optional filters, large conditional
aggregates, or a query whose generated API would obscure its semantics. It is
not permission to use an ORM, concatenate SQL, or hide a transaction. A
Postgres adapter receives `Queries.WithTx(tx)` internally; a feature service
sees only its own transaction-bound consumer port, so every query still uses
exactly the command transaction without leaking sqlc or pgx outward.

### 0.3 Auth model and lifecycle

Custom Go auth is frozen. There is no Better Auth, Authboss, GoTrue, Ory,
Zitadel, JWT identity token, OAuth, or third-party authentication server in
the final runtime.

```text
auth_user(
  id uuid primary key,
  kind text not null check (kind in ('anonymous','registered','admin')),
  created_at timestamptz not null,
  disabled_at timestamptz null
)
auth_credential(
  auth_user_id uuid primary key references auth_user(id) on delete restrict,
  email_normalized text not null unique,
  password_hash text not null,
  created_at timestamptz not null,
  password_updated_at timestamptz not null
)
auth_session(
  id uuid primary key,
  auth_user_id uuid not null references auth_user(id) on delete restrict,
  token_hash bytea not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  last_used_at timestamptz not null,
  revoked_at timestamptz null
)
admin_user(
  auth_user_id uuid primary key references auth_user(id) on delete restrict,
  created_at timestamptz not null
)
auth_rate_limit(
  scope text not null, subject text not null, window_started_at timestamptz not null,
  count integer not null check (count >= 0), primary key (scope, subject)
)
```

Index active sessions by `(auth_user_id, expires_at)` and expired/revoked rows
by `expires_at`; use the unique credential email and token hash indexes for
lookup. No auth table stores Participant profile data, a raw session token,
OAuth metadata, image/name, plaintext password, or IP/user-agent metadata.
`participant.auth_user_id` remains unique and refers to `auth_user.id` with
`RESTRICT`. Its stable Participant, memberships, and history are unchanged.

An anonymous `auth_user` and session are created **only by an explicit
non-idempotent `POST /api/v1/auth/anonymous`** initiated by the client after
the user chooses to start/onboard or needs an authenticated join action.
`GET`, link opening, route prefetch, public invite/rejoin inspection, and
landing at `/` do not create an auth row, cookie, or Participant. An auth
session may exist without a Participant. `POST /onboarding` is the only
operation that creates a Participant, and it is idempotent for that auth user.

An anonymous-to-registered upgrade locks the current `auth_user` and its
Participant mapping, normalizes the supplied email (`TrimSpace` then Unicode
case-folded lowercase), checks the unique credential row, hashes the password,
inserts `auth_credential`, and changes `auth_user.kind` to `registered` in one
transaction. It preserves the exact same `auth_user.id`, `participant.id`,
memberships, Pair ownership, history, and existing sessions. A duplicate email
returns `EMAIL_IN_USE` with no merge, no Participant copy, and no session
change. Unlike ADR 001's Better Auth workaround, no mapping repoint occurs.

Direct consumer registration is allowed: create one registered `auth_user`,
credential, and current session, but no Participant until explicit onboarding.
An existing registered user logs in on another device and receives a new
session for that same auth user. An anonymous browser that tries an owned email
gets `EMAIL_IN_USE`; it stays anonymous and retains its separate data. Login
from a browser with an anonymous session first revokes only that browser's
anonymous session, clears the cookie/client query state, then creates a session
for the authenticated existing account. It never merges either Participant or
domain history.

Passwords are accepted only at 8–128 UTF-8 bytes after validation. Hash with
Argon2id version 19, 64 MiB memory, 3 iterations, parallelism 1, a fresh
16-byte cryptographic salt, and a 32-byte derived key; persist the standard
encoded Argon2id string. Verification uses constant-time library comparison;
if stored parameters are weaker than the current policy, rehash and update the
credential in the successful-login transaction. Passwords and raw credentials
are never logged or persisted outside the hash.

Sessions use 32 random bytes encoded base64url. Only `SHA-256(raw-token)` is
stored. The cookie is `closer_session`, `HttpOnly`, `Path=/`, `SameSite=Lax`,
`Secure` outside local development, and has a 7-day sliding expiry with an
absolute 30-day ceiling from creation. Renew the database and cookie expiry at
most once per 24 hours; do not rotate the raw token merely for normal use.
Logout revokes the current session and expires its cookie; logout-all revokes
every unexpired session for the actor and is an explicitly separate command.
Password change/recovery revokes all of that auth user's sessions, including
the initiator, and requires a new login. Expired/revoked sessions are deleted
by a daily bounded job and may be opportunistically removed on lookup.

Login deliberately returns one `INVALID_CREDENTIALS` result for unknown email,
wrong password, disabled account, and a non-credential anonymous user. It
performs a dummy Argon2id verification for absent credentials to reduce timing
distinction. Consumer email verification and email-delivered password reset
are deferred from V1; no endpoint claims to deliver reset email. Admin recovery
is instead the existing privileged operator concept: a local operator command
identifies an existing `admin_user` by configured bootstrap identity, sets a
new password, and revokes only that Admin's sessions. It cannot reset an
arbitrary user.

Admin is an `auth_user` with `kind='admin'` and an `admin_user` row, never a
Participant. The final bootstrap command accepts a dedicated unused email and
password, creates both rows plus the credential transactionally, and is a no-op
only if that email already belongs to the same `admin_user`; an existing
consumer or unlisted auth user fails without promotion. `ADMIN_USER_ID` is a
Better Auth transition detail and is not used for Go authorization. Admin
login remains hidden/unlinked only for discoverability; every Admin route also
requires a valid session and `admin_user` membership.

### 0.4 Request security, error model, and API versioning

The final API is `/api/v1/...`. The SPA and API are same-origin in production;
Vite development origin is an explicit configured origin. Every cookie-auth
mutation requires an allow-listed `Origin` exactly matching the configured
public app origin (or configured Vite origin in development). A missing Origin
is accepted only for same-site, non-browser operational endpoints that use a
separate operator credential; browser cookie mutations without Origin fail.
No wildcard CORS is used. Cross-origin credentials are not supported. `GET`,
`HEAD`, `OPTIONS`, SSE, and public invite inspection do not mutate state;
SameSite Lax is defense in depth, not the CSRF control.

Trust a client IP only from a configured, trusted reverse proxy. Without that
proxy, the direct remote address is the rate-limit subject; arbitrary
`X-Forwarded-For` is ignored. `auth_rate_limit` uses an upsert under row lock.
Admin login is exactly five attempts per IP per rolling fixed one-minute
window, durable across API instances; attempt six returns `RATE_LIMITED` 429
with `Retry-After`. Consumer login is 10 attempts per IP per minute and 10 per
normalized-email per minute, with both checks required. There is no global
account lockout. A daily bounded cleanup removes old limit windows.

Every non-success JSON response is
`{"error":{"code":"...","message":"...","requestId":"..."}}`.
The stable code, not prose, drives the frontend. `UNAUTHENTICATED` is 401;
`FORBIDDEN` is 403 only for non-sensitive Admin access; unauthorized Pair,
Private, Together, invite, and history resources collapse to `NOT_FOUND` 404;
`VALIDATION_ERROR` 400; `RATE_LIMITED` 429; `EMAIL_IN_USE` 409; `CONFLICT`,
`STALE_REVISION`,
`ANSWER_IMMUTABLE`, `CANDIDATE_ALREADY_RESOLVED`, `ROUND_ALREADY_RESOLVED`, and
`ROUND_NOT_REVEALABLE` 409; `PAIR_TERMINATED` 409; `INVITE_INVALID` 404;
`INVITE_EXPIRED`, `PAIR_ALREADY_CLAIMED`, `DUPLICATE_ACTIVE_PAIR`, and
`QUESTION_UNAVAILABLE` 409; and `INTERNAL_ERROR` 500. Raw PostgreSQL errors
never leave the server. The API uses a major URL version because Vite and Go
can deploy independently; additive fields are backward-compatible within v1,
while removal or semantic change requires `/api/v2` and an overlap window.

### 0.5 Transactions, locks, Private, Together, and realtime

Every mutating domain service follows: start transaction; acquire locks in the
documented global order; validate actor/state; check idempotency; mutate;
commit; publish a metadata-only invalidation after commit; return the committed
projection. Notification failure never rolls back a committed command. All
Pair-scoped mutation begins by locking `pair` first. Where needed, locks then
progress `pair -> active membership/era -> Conversation/Session -> candidate or
Round -> answer/reveal/child row`; Question administration instead locks
`question -> current revision -> affected unresolved candidates`. This order is
mandatory across services.

| Command/race                      | Locked rows and convergence                                                                          | Retry result / event                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| initial issue/reuse/replace       | Pair; usable invite; token hash unique                                                               | existing/one replacement result; `pair.changed`                                                                       |
| initial claim                     | Pair; invite; memberships/era; ordered-pair advisory transaction lock                                | consumed result or exact conflict; `pair.changed`                                                                     |
| guest rejoin replacement          | Pair; target membership/active era; credential; auth/session ownership; affected candidates/Sessions | new Participant/membership/era in the same slot or conflict; `pair.changed` after commit                              |
| termination                       | Pair; active memberships/era; active credentials/Candidates/Sessions                                 | repeated terminate returns terminal projection; `pair.terminated`                                                     |
| Private start/resume              | Pair; active era; category Conversation; active unresolved-round guard                               | unique Pair/era/category converges; `private.changed`                                                                 |
| Ask vs Skip                       | Pair; Conversation; unresolved candidate                                                             | conditional candidate state + unique Round/request IDs; same idempotent result; `private.changed`                     |
| Skip retry                        | same, plus `(conversation_id, skip_request_id)` unique                                               | stored next-candidate/exhausted result; `private.changed` once                                                        |
| Like vs Ask/Skip                  | Pair; Conversation; unresolved candidate                                                             | Like conditionally updates only unresolved row, otherwise conflict; `private.changed` only for state-changing command |
| withdrawal vs candidate           | Question; revision; all unresolved pinned candidates in deterministic ID order                       | first withdrawal facts retained; candidate invalidated; `private.changed` per affected Pair after commit              |
| Answer / Decline / Reveal         | Pair; era; Conversation; Round; answer/reveal children                                               | answer unique and immutable; conditional decline/reveal convergence; `private.changed`                                |
| post-Reveal progression           | Pair; Conversation; completed Round; new candidate                                                   | both Reveal Views required; creator-only candidate result; `private.changed`                                          |
| Together Start/Next/Skip/Like/End | Pair; active Session; current shown occurrence                                                       | request unique/current-card checks; replay persisted result; `together.changed`                                       |
| Question revision edit            | Question; current revision                                                                           | expected ID + unique ordinal; stale is `STALE_REVISION`; no Pair event                                                |

The Private projection is participant-relative. A non-creator at unresolved
candidate state receives only `WAITING_FOR_CREATOR`, the already shared Pair and
category lane, and a safe refresh/version marker. It receives **no** candidate
ID, Question ID, QuestionRevision ID, text, intensity, Like state, timestamp,
selection rank/seed, or candidate metadata through JSON, logs, events, client
cache, prefetch, hydration, or errors. The creator alone receives the candidate
until Ask. Candidate states are `unresolved`, `asked`, `skipped`, and
`invalidated`; Ask creates one exact-revision Round, Skip consumes the logical
Question and persists the next result, Like never consumes, and withdrawal/era
end/termination invalidates without a Round. Round commands preserve current
answer, Decline, Reveal, reaction/reply, former-history, and creator-progression
rules exactly as specified in ADR 003's 2026-09-20 amendment and ADR 005.

Together preserves the deterministic persisted occurrence, exact revision,
logical no-repeat, category access, intensity ramp/fallback, Start/Next/Skip/
Like/End, and occurrence analytics. Its old TypeScript buffering mechanism is
not itself a parity requirement if the Go/Vite port gives the same persisted
result and instant-feeling UI.

Realtime is `pg_notify` after commit -> one session-capable `LISTEN` connection
per API process -> local `map[pairID]subscriber-set` -> authorized SSE ->
TanStack Query invalidation/refetch. Payload remains exactly
`{version:1,pairId,type}` and type remains one of `pair.changed`,
`private.changed`, `together.changed`, or `pair.terminated`; it never contains
content or credentials. SSE sends a 20-second heartbeat, uses each subscriber
as a one-event nonblocking buffer (drop duplicate/stale invalidations for a
slow client rather than blocking a command), and removes it on disconnect or
write failure. Authorize Pair access before subscription, close/navigate on
termination, reconnect EventSource with bounded exponential backoff, and
refetch on focus/reconnect. Correctness never depends on every event arriving.
Each Go instance has its own listener and local registry; PostgreSQL fanout
makes multi-instance delivery valid without Redis.

### 0.6 Frontend, contracts, PWA, schema transition, and test database

During the port, preserve `apps/web` as the frozen Next behavioral reference,
create `apps/api` for Go, and create `apps/web-vite` for the new frontend. Do
not rename the existing app first. At parity cutover, move Vite to `apps/web`
only as one deliberate migration, retain the legacy app until rollback retention
ends, then remove it and its Better Auth/Next-specific code. Reuse Tailwind,
shadcn primitives, Closer components/tokens/icons/copy, Admin design,
responsive/accessibility fixes, React Hook Form, Zod client validation, and
TanStack Query concepts. Rewrite only Next routing, Server Components/actions,
Next cache/fetch behavior, and Next-only APIs.

React Router uses the current paths for root, login, onboarding, create, Space
selection/Pair Home, invite/join/rejoin, Together, Private, history, settings,
Admin login, and Admin routes. `/dashboard` redirects to `/` during transition.
Loaders/guards are UX only and may call `GET /api/v1/me`; API authorization is
always authoritative. Static hosting supplies `index.html` fallback for
non-`/api` deep links on Vercel transition hosting and Caddy. Public landing
routes remain safe before auth; private routes never preload protected data.

Go owns an OpenAPI 3.1 document committed under `apps/api`; generated TypeScript
transport types/client are generated into `apps/web-vite/src/api/generated` in
the implementation ticket, with a CI drift check. Handwritten Zod schemas
validate untrusted form input and critical API responses at the boundary; they
do not duplicate domain rules. This is deliberately small OpenAPI generation,
not a new platform. Versioned contract changes require the OpenAPI update,
generated-client update, and consumer compatibility test together.

The Vite PWA manifest starts at `/`, not stale `/new`. Its service worker uses
app-shell navigation fallback only for static routes, caches versioned static
assets, installs updates waiting for explicit user reload, and never caches
authenticated JSON, mutation responses, cookies, SSE, or `/api/v1/**`. V1 has
no offline write queue and no offline domain state machine.

### Schema ownership amendment

The existing Drizzle schema remains the **semantic reference** for Closer
domain concepts and constraints: Participant, Pair, memberships, membership
eras, Question/QuestionRevision, Together, Private, history, and Admin
analytics. It is not the executable schema for the new Go runtime where the
architecture intentionally diverges from Better Auth.

The Go runtime owns executable rewrite schema under `apps/api/db/schema/`.
`auth_user.id` is UUID and `participant.auth_user_id` is a unique UUID foreign
key to it. Legacy Better Auth text IDs remain exclusive to the legacy Next
application. There is no identity mapping, text-to-UUID bridge, or dual auth
foreign key. Go and legacy runtimes may be compared by observable behavior but
do not share physical identity rows or auth tables.

The ordered `db/schema/*.sql` files are a reproducible pre-launch bootstrap for
local rewrite and `closer_test` databases, not the production migration
framework. Before real production users exist, create and verify a proper
versioned migration baseline from the final Go schema. The test-database reset
command is guarded to the local database named exactly `closer_test`; ordinary
Go tests never reset a database. No `db:push` is used to install Go schema.

Use an isolated local `closer_test` database selected only by
`CLOSER_TEST_DATABASE_URL`; `closer_dev` is never a test target. The test
harness refuses any target other than the exact database name `closer_test`.
Only the explicit schema-reset command can drop its `public` schema; ordinary
tests do not reset or truncate the database. CI creates ephemeral PostgreSQL
and bootstraps the same Go schema. A hosted Neon test branch is not required.

## 1. Current repository map

| Area               | Current location                                                                                        | Responsibility                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Web application    | `apps/web/`                                                                                             | Next.js 16 App Router, Server Components, Route Handlers, client React, TanStack Query |
| Shared UI          | `packages/ui/src/components/` and `packages/ui/src/styles/globals.css`                                  | shadcn-style primitives, Tailwind v4, Closer tokens                                    |
| Domain/persistence | `packages/db/src/closer.ts`                                                                             | transactional Closer operations and projections                                        |
| DB schema          | `packages/db/src/schema/closer.ts`                                                                      | Closer tables, enums, indexes, checks, composite FKs                                   |
| Legacy auth schema | `packages/db/src/schema/auth.ts`                                                                        | Better Auth tables used only by the legacy Next runtime                                |
| Go auth/domain DDL | `apps/api/db/schema/*.sql`                                                                              | Executable custom-auth and Go-owned domain schema for local rewrite/closer_test        |
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

| Capability               | Current operations                                                                                                                | Main reference                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Participant              | `resolveOrCreateParticipant`, `getParticipantByAuthUserId`                                                                        | `packages/db/src/closer.ts:L210-L248`                                                                                                        |
| Question/Admin catalog   | create Question, create revision, restore, duplicate search, activate, reactivate, deactivate, withdraw                           | `packages/db/src/closer.ts:L250-L647`                                                                                                        |
| Pair access/lifecycle    | list spaces, active access, complete access, status, terminate                                                                    | `packages/db/src/closer.ts:L657-L856`, `L1549-L1651`                                                                                         |
| Pair creation            | `createPairForParticipant`, `updateIntendedPersonName`                                                                            | `packages/db/src/closer.ts:L891-L982`                                                                                                        |
| Initial invite           | status, issue/reuse, replace, usable check, revoke, landing, redeem                                                               | `packages/db/src/closer.ts:L858-L1278`                                                                                                       |
| Guest rejoin replacement | issue/revoke, landing, redeem; old/new membership-era boundary and history isolation                                              | Go invite service/store and `apps/api/internal/httpapi/rejoin_integration_test.go`; `packages/db/src/rejoin-replacement.integration.test.ts` |
| Together                 | start, playback, page, advance/skip, like, end                                                                                    | `packages/db/src/closer.ts:L1653-L2284`                                                                                                      |
| Private                  | list eligible, start/resume, candidate select/Skip/Like, round projection/status, answer, Decline/retire, Reveal, reaction, reply | `packages/db/src/closer.ts:L2286-L4040`                                                                                                      |
| Former history           | `getFormerEraHistoryForParticipant`                                                                                               | `packages/db/src/closer.ts:L3516-L3827`                                                                                                      |
| Realtime                 | `publishRealtimeEvent`, `getRealtimeBus`                                                                                          | `packages/db/src/realtime.ts:L1-L158`                                                                                                        |

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
| `rejoin_invite`              | Guest replacement credential                                     | hash unique; Pair and target membership/Participant indexes                                    | Preserve separately from initial invite, 24-hour expiry               |
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

The legacy Drizzle schema is pre-launch and applied with manual `db:push`; no
migration history is authoritative. It remains the semantic domain reference.
The Go runtime owns ordered executable bootstrap DDL under `apps/api/db/schema/`
and intentionally replaces the old auth dependency with UUID `auth_user` rows.
That bootstrap is not the final production migration framework; a proper
versioned baseline must be established before real production users exist.

## 5. Transaction and locking map

| Operation                          | Current strategy                                                                                                                                                                                                      | Race prevented                                                                          | Go equivalent                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pair creation                      | transaction; unique `creation_request_id`; `ON CONFLICT DO NOTHING`                                                                                                                                                   | retried create does not duplicate Pair                                                  | `CreatePair(ctx, tx)` plus unique request ID                                  |
| Initial invite issue/reuse/replace | Pair row lock; active sole-member check; unique token hash                                                                                                                                                            | two browsers do not create two usable invitations; replace is explicit                  | `SELECT pair FOR UPDATE`, then revoke/insert                                  |
| Initial claim                      | transaction; active Pair row lock; token lifecycle checks; advisory lock on unordered Participant pair; unique active slot                                                                                            | termination/claim ordering, duplicate active Pair, double claim                         | same row lock plus `pg_advisory_xact_lock` or a deterministic lock row        |
| Together start                     | Pair row lock; start request unique; persisted first card                                                                                                                                                             | duplicate Start, claim/start race                                                       | one pgx tx with Pair lock and unique request                                  |
| Together Next/Skip                 | mutable session and session row locks; advance request unique; current-card check                                                                                                                                     | concurrent Next/Skip and stale client                                                   | lock Pair/session, update current card, insert next                           |
| Together Like/End                  | Pair/session row lock; current-card/session checks                                                                                                                                                                    | stale Like and post-end mutation                                                        | same tx and terminal error                                                    |
| Private start/category             | Pair lock; active-era check; unique Pair/era/category; active unresolved Round guard                                                                                                                                  | duplicate Conversation, cross-category open Round overlap                               | Pair lock, then unique insert/select                                          |
| Private Ask                        | Pair, conversation, candidate locks; unresolved guard; candidate update + Round insert                                                                                                                                | Ask/Skip race, duplicate Round, candidate leakage                                       | one tx; update state conditionally; unique idempotency                        |
| Private Skip                       | same locks; unique `(conversation_id, skip_request_id)`; persisted next candidate                                                                                                                                     | retry consumes one logical Question only                                                | one tx; return stored `skip_result_candidate_id`                              |
| Private first answer               | Pair lock; commit provisional Round atomically; one initiator unresolved check; unique answer                                                                                                                         | overlapping initiator work and answer/termination race                                  | Pair lock through commit and answer insert                                    |
| Private Decline                    | Pair lock; answer count/actor check; status update conditional                                                                                                                                                        | pass vs answer and duplicate pass                                                       | update open row under Pair lock                                               |
| Reveal/reaction/reply              | Pair lock for mutable round; unique viewer records/upserts                                                                                                                                                            | unauthorized or stale post-reveal writes                                                | authorization projection inside tx, unique upsert                             |
| Guest rejoin replacement           | Pair row lock; credential lock; current target membership/Participant and era locks; auth/session ownership checks; close old era; invalidate candidates; end Together; create replacement Participant/membership/era | double redemption; replacement vs Private/Together/termination; ended/registered target | one tx from Pair lock through new era; same logical slot, no history transfer |
| Termination                        | Pair row lock, active membership locks, one tx cleanup                                                                                                                                                                | termination vs every Pair-scoped mutation; idempotent repeat                            | same exact order; terminal Pair check first                                   |
| Revision edit                      | Question row lock; expected current revision; unique per-question ordinal                                                                                                                                             | stale Admin writer and pointer regression                                               | `SELECT question FOR UPDATE`; compare expected ID; insert next revision       |
| Withdrawal                         | Question/revision row lock; first withdrawal facts preserved; invalidate unresolved candidate                                                                                                                         | duplicate withdrawal and safety race                                                    | revision lock plus candidate invalidation in same tx                          |

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

### Historical REWRITE-00 auth proposal (superseded by section 0.3)

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
- Anonymous upgrade attaches credentials to the same Go `auth_user` UUID in
  one transaction. Once GO-04 has created a Participant, that unchanged UUID
  preserves the Participant and Pair ownership directly; no mapping repoint,
  second identity, ownership rewrite, or Better Auth compatibility layer is
  involved.
- Admin is a dedicated auth identity with no Participant row. Bootstrap is
  explicit and idempotent only for the configured email; recovery targets only
  the configured Admin and revokes all its sessions.
- Enforce five Admin sign-in attempts per IP per minute with a DB counter. Do
  not add global account lockout. Keep trusted-origin/CSRF checks for cookie
  mutations.

The Go executable schema uses the frozen custom auth tables and references
Participants directly through `participant.auth_user_id UUID REFERENCES
auth_user(id) ON DELETE RESTRICT`. It ports Closer domain tables and constraints
from the semantic Drizzle reference without retaining Better Auth IDs or adding
an identity mapping. Nice-to-have auth changes (OAuth, email verification,
password reset, multi-admin RBAC) are out of scope until separately specified.

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
- Guest rejoin targets an occupied eligible anonymous slot after session loss.
  It keeps the Pair and logical slot, but creates a new Participant,
  membership, and era. The old membership and era end, the former display name
  is frozen, unresolved candidates are invalidated, old-era Together Sessions
  end, and the replacement receives no former Private or Together history.
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
/pair/:pairId/rejoin      guest replacement rejoin controls
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

## 12. Historical REWRITE-00 package layout (superseded by section 0.1)

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

## 13. Historical REWRITE-00 SQLC/PGX design (superseded by sections 0.1–0.2)

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

## 14. Historical REWRITE-00 error model (superseded by sections 0.1b and 0.4)

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

## 15. Historical REWRITE-00 suitability verdict

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
