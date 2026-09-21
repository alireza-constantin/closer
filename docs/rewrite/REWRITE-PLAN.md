# Closer rewrite plan and cutover

The plan is dependency-first and keeps the current Next/Bun application live
until parity is proven. Each ticket is intended to be one reviewable commit;
tests and migrations are part of the ticket rather than follow-up cleanup.

## 1. Ticket sequence

| Ticket     | Goal                                                                        | Dependencies                   | Main current references                     | Acceptance/risk                                      |
| ---------- | --------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------- | ---------------------------------------------------- |
| REWRITE-00 | This audit and parity specification                                         | none                           | root docs, all sources                      | docs only; complete                                  |
| GO-01      | Go server, chi, config, slog, health                                        | REWRITE-00                     | `package.json`, env files, `vercel.json`    | `/healthz` and graceful shutdown; low                |
| GO-02      | pgx pool, sqlc, baseline migration, transaction helpers                     | GO-01                          | `packages/db/src/schema/*`, `closer.ts`     | schema checksum and lock smoke tests; high           |
| GO-03      | sessions, credentials, anonymous identity upgrade, Admin bootstrap/recovery | GO-02                          | `packages/auth/src/*`, auth schema, ADR 001 | auth/parity tests green; highest auth risk           |
| GO-04      | Participant, Pair access, create, status, name edit                         | GO-02, GO-03                   | `closer.ts:L210-L248,L657-L982`             | actor-relative projections; medium                   |
| GO-05      | initial invite issue/reuse/replace/landing/claim                            | GO-04                          | `closer.ts:L858-L1278`, ADR 002             | hash-only and race tests; high                       |
| GO-06      | eras, guest rejoin/replacement, termination                                 | GO-04, GO-05                   | `closer.ts:L762-L856,L1280-L1547`, ADR 005  | commit-order/history tests; highest lifecycle risk   |
| GO-07      | Question/revision catalog domain                                            | GO-02, GO-03                   | `closer.ts:L250-L647`, ADR 006              | stale conflict, withdrawal, no hard delete; high     |
| GO-08      | Together core session and persisted cards                                   | GO-04, GO-07                   | `closer.ts:L1653-L2284`                     | category/start/end projections; medium               |
| GO-09      | Together deterministic playback and buffered pages                          | GO-08                          | `together-playback.ts`                      | ramp, fallback, no-repeat, idempotency; medium       |
| GO-10      | Private Conversation and creator candidate selection                        | GO-04, GO-06, GO-07            | `closer.ts:L2666-L3143`, ADR 003            | candidate secrecy and Pair guard; highest risk       |
| GO-11      | Private Skip/Like and candidate invalidation                                | GO-10                          | `closer.ts:L3204-L3302`, Admin PRIVATE-01   | retry/consumption/freeze tests; highest risk         |
| GO-12      | Private answer/Decline/round lifecycle                                      | GO-10                          | `closer.ts:L3829-L3931`                     | answer race and terminal pass; high                  |
| GO-13      | Reveal, reactions, replies, history                                         | GO-12, GO-06                   | `closer.ts:L3933-L4040,L3516-L3827`         | confidentiality and former-era history; highest risk |
| GO-14      | Realtime LISTEN/NOTIFY, registry, SSE                                       | GO-04, GO-08, GO-10            | `realtime.ts`, SSE route                    | exact events, reconnect, no content; high            |
| GO-15      | Admin catalog HTTP and projections                                          | GO-03, GO-07                   | `admin-question.service.ts`, Admin routes   | protected CRUD/lifecycle contracts; medium           |
| GO-16      | Admin analytics/inventory                                                   | GO-07, GO-11, GO-15            | analytics/overview services, canonical docs | five-Pair suppression/formulas; high privacy risk    |
| WEB-01     | Vite React Router PWA shell and API client                                  | GO-01, GO-14                   | `app/layout.tsx`, manifest, providers       | installable shell; resolve `/new` stale start URL    |
| WEB-02     | auth/onboarding and participant-aware entry                                 | GO-03, WEB-01                  | `features/auth`, root pages                 | no protected data before `/api/me`; high             |
| WEB-03     | Pair Home, Pair creation, invite/join/rejoin                                | GO-04, GO-05, GO-06, WEB-02    | pair/invite features                        | exact projection and token handling; high            |
| WEB-04     | Together screens                                                            | GO-08, GO-09, GO-14, WEB-03    | `features/together-session`                 | preserve picker/playback semantics; medium           |
| WEB-05     | Private screens                                                             | GO-10–GO-13, GO-14, WEB-03     | `features/private-conversation`             | no client confidentiality leak; highest              |
| WEB-06     | history/settings/termination                                                | GO-06, GO-13, WEB-03           | history and Pair controls                   | era/termination projections; high                    |
| WEB-07     | Admin login/catalog/analytics                                               | GO-15, GO-16, WEB-01           | `app/admin/**`                              | no consumer/Admin mixing; medium                     |
| WEB-08     | responsive, accessibility, visual parity                                    | WEB-02–07                      | UI tokens/components/tests                  | approved Soft Modern design; medium                  |
| CUTOVER-01 | black-box parity and security verification                                  | all GO/WEB                     | this checklist                              | all MUST PORT tests green; gate                      |
| CUTOVER-02 | VPS staging, backup/restore, deploy rehearsal                               | CUTOVER-01                     | runbook/env/Vercel docs                     | rollback rehearsal and health checks; medium         |
| CUTOVER-03 | make new stack default and retain rollback                                  | CUTOVER-02                     | repo layout and proxy                       | old app still restorable; high                       |
| CUTOVER-04 | remove legacy Next/Bun only after retention window                          | CUTOVER-03 + explicit approval | `apps/web-next` legacy tree                 | deletion is the final irreversible step              |

Every ticket must record: Goal, Dependencies, current reference files, likely
new files, invariants, schema/API impact, tests, acceptance criteria, and
cutover risk. The table above supplies those fields compactly; ticket issues
should expand them before implementation begins.

### Per-ticket implementation detail

The following compact matrix makes the required fields explicit for every
ticket. Paths are likely ownership locations, not a commitment to create every
file if an existing abstraction is sufficient.

| Ticket     | Likely new files                                                               | Invariant / schema / API impact                                      | Tests and acceptance gate                                    |
| ---------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| REWRITE-00 | `docs/rewrite/*.md`                                                            | no schema or API mutation; preserve contradictions                   | docs complete, `git diff --check`                            |
| GO-01      | `apps/api/cmd/server`, `internal/httpapi`, service unit template               | health/readiness only; no domain tables                              | build, graceful shutdown, health checks                      |
| GO-02      | `apps/api/db/queries`, `db/migrations`, `sqlc.yaml`, `internal/postgres`       | reviewed baseline, pgx tx/lock helpers, no behavior drift            | schema diff, lock smoke tests, no `db:push`                  |
| GO-03      | `internal/auth`, auth queries/migrations, auth contract tests                  | session/credential/admin tables; Participant mapping unchanged       | auth/linking/bootstrap/recovery/rate-limit parity            |
| GO-04      | `internal/participant`, `internal/pair`, Pair handlers/DTOs                    | Pair access, actor-relative status, Pair commands                    | Pair/domain integration and HTTP contract tests              |
| GO-05      | `internal/invite`, invite handlers/DTOs                                        | hash-only initial token, single-use/7-day, claim tx                  | issue/reuse/replace/claim race and token leak tests          |
| GO-06      | era/replacement/termination files under `internal/pair` and `internal/history` | membership-era/history boundaries and terminal cleanup               | commit-order, replacement, termination, former-history tests |
| GO-07      | `internal/question`, question sqlc queries and admin domain tests              | immutable revisions, current pointer FK, lifecycle events            | revision conflicts, withdrawal, duplicate warning tests      |
| GO-08      | `internal/together` core commands/queries                                      | session/card persistence and era binding                             | start/end/category and projection parity                     |
| GO-09      | Together selection helpers and page queries                                    | seed, logical no-repeat, ramp/fallback; buffering may vary           | deterministic selection, exhaustion, idempotency tests       |
| GO-10      | `internal/private` conversation/candidate commands                             | creator-only candidate, one era/category, Pair-wide unresolved guard | candidate confidentiality and concurrent start/Ask tests     |
| GO-11      | Private candidate command queries/handlers                                     | Skip request uniqueness, logical consumption, Like freeze            | Ask/Skip race/retry, invalidation, analytics fixture tests   |
| GO-12      | Private round command queries/handlers                                         | immutable answer, commit boundary, Decline terminality               | answer/Decline race, one/two answer visibility               |
| GO-13      | Reveal/history/reaction/reply code and DTOs                                    | both Reveal Views, post-reveal mutation, era history                 | reveal confidentiality, reaction/reply, replacement history  |
| GO-14      | `internal/realtime`, SSE handler/middleware                                    | exact event vocabulary, metadata-only payload, listener lifecycle    | listener/reconnect/SSE/client invalidation tests             |
| GO-15      | `internal/admin`, admin HTTP handlers/DTOs                                     | Admin-only catalog and lifecycle; no Participant resolution          | auth/origin/contract/409 and catalog tests                   |
| GO-16      | admin aggregate sqlc queries and analytics handlers                            | five-Pair suppression, current/all revision scope, inventory         | formula/privacy/inventory tests                              |
| WEB-01     | `apps/web/src/main`, router, PWA/Vite config, API client                       | static shell only; fix manifest `/new` vs `/create`                  | build/install/offline shell and route tests                  |
| WEB-02     | Vite auth routes/hooks and actor query                                         | no protected preload; cookie auth remains server-authoritative       | sign-in/onboarding/anonymous upgrade tests                   |
| WEB-03     | Pair/invite route components and API hooks                                     | safe landing projections; explicit redeem/mutation boundaries        | Pair/invite/rejoin/confidentiality tests                     |
| WEB-04     | Together route screens/hooks                                                   | client cache follows server current card; no local authority         | playback/ramp/reconnect UI tests                             |
| WEB-05     | Private route screens/hooks                                                    | forbidden candidate/answer fields never enter client state           | candidate/answer/reveal security tests                       |
| WEB-06     | history/settings/termination routes/hooks                                      | former-era projection and terminal state are read-only               | history/termination route tests                              |
| WEB-07     | Admin routes, forms, analytics views                                           | Admin session isolated from consumer Participant                     | Admin UI/contract/accessibility tests                        |
| WEB-08     | responsive/a11y test fixtures and targeted style changes                       | preserve Closer tokens and semantic components                       | keyboard/mobile/a11y/visual parity checks                    |
| CUTOVER-01 | parity runner, normalized fixtures, security scans                             | semantic JSON/state equivalence; no data mutation beyond fixtures    | all MUST PORT checks green                                   |
| CUTOVER-02 | VPS unit/Caddy/config/runbook files                                            | deployment is reproducible, backed up, and reversible                | staging deploy/restore/health/SSE smoke                      |
| CUTOVER-03 | release switch and compatibility config                                        | old app remains readable during rollback window                      | production-like canary and rollback rehearsal                |
| CUTOVER-04 | deletion is limited to approved legacy paths                                   | no old app removal before explicit approval and retention exit       | final audit, backup, and signed go/no-go                     |

## 2. Schema strategy

Choose A initially: keep the current Closer schema nearly unchanged. The domain
has already paid for explicit membership eras, pinned revisions, candidate
states, idempotency keys, and composite constraints. A clean redesign during a
runtime rewrite would multiply parity risk.

Required changes:

1. Replace or compatibility-wrap Better Auth `user/session/account` storage
   with the explicit Go auth model, while preserving `participant.auth_user_id`
   references or migrating them transactionally.
2. Add the reviewed migration baseline and sqlc schema metadata.
3. Add only indexes proven necessary by Go query plans; do not weaken existing
   uniqueness, partial indexes, or composite foreign keys.
4. Decide whether `verification` is retained only if email verification/reset
   is in the launch scope.

Nice-to-have changes: rename tables for Go style, consolidate auth metadata,
add RBAC, add analytics event tables, or change the era representation. None is
required for parity and all should wait.

## 3. Safe cutover layout

During transition use:

```text
apps/web-next/   # current Next app moved here only after the new build is stable
apps/web/        # new Vite PWA
apps/api/        # Go API
packages/ui/     # shared React/Tailwind primitives during the port
packages/db/     # retained until Go parity and migration baseline are proven
```

Do not move the current app at the beginning. First add `apps/api` and a new
Vite app on a branch or worktree, then run both against disposable fixtures.
When the Vite app is ready, rename the old app to `web-next` in a focused
repository change and make `apps/web` the default build. Keep the old Next app,
its route handlers, tests, and deployment instructions until the rollback
retention window ends. Delete only in CUTOVER-04 with explicit approval.

Rollback before final deletion is a Caddy/release switch back to the old Next
build and its known-good API/database compatibility state. Because data is
shared, CUTOVER-03 must forbid irreversible schema changes that the old app
cannot read; if an auth migration is not backwards-compatible, keep a tested
dual-read/dual-session bridge until rollback is no longer required.

## 4. Black-box parity gates

Stop and evaluate at these checkpoints:

1. after GO-03 Auth: anonymous onboarding, registration upgrade, Admin login,
   rate limit, logout, and session revocation;
2. after GO-06 Pair/invite/replacement: all commit-order races and history;
3. after GO-09 Together: ramp, selection, buffering, exhaustion;
4. after GO-13 Private: confidentiality, candidate control, concurrency,
   Reveal, Decline, history;
5. after GO-14 Realtime: reconnect and cross-instance behavior;
6. before WEB-01 replaces the default web entry;
7. before CUTOVER-03 makes Go/Vite authoritative;
8. before CUTOVER-04 removes legacy code.

At each gate compare normalized JSON projections and state digests, not only
screen screenshots.

## 5. VPS target

For 2 vCPU / 4 GB RAM / 60 GB SSD, use one host:

```text
Caddy :443/:80
  /       -> static Vite dist
  /api/*  -> 127.0.0.1:8080 Go API
  /events -> 127.0.0.1:8080 Go API (or route by /api/pairs/.../events)
PostgreSQL -> 127.0.0.1:5432 only
```

Processes and accounts:

- `closer-api.service` as an unprivileged `closer` user, `Restart=on-failure`,
  bounded connection pool, `/healthz` and `/readyz` checks;
- native PostgreSQL under its own service account, local-only binding,
  autovacuum enabled, and a database role limited to Closer;
- Caddy as the only public listener, automatic TLS, request-size/timeouts
  suitable for SSE, and buffering disabled for `/api/pairs/*/events`;
- environment files readable only by the service account; no secrets in the
  repository or logs.

Backups: nightly PostgreSQL logical or physical backup to storage outside the
60 GB root disk, encrypted in transit/at rest, with a tested restore at least
before cutover and periodically thereafter. Keep WAL/PITR only if the chosen
storage budget supports it. Rotate Caddy/API/PostgreSQL logs with bounded disk
retention. Health checks must validate DB connectivity and a simple read-only
query; they must not mutate schema.

Deployment steps:

1. build Vite static assets and the Go binary in CI or a controlled builder;
2. upload versioned artifacts, install systemd unit/config, and run migrations
   in an explicit reviewed step;
3. run health/readiness and parity smoke tests;
4. reload Caddy and restart the API with graceful shutdown;
5. verify SSE connect/reconnect, auth, Pair Home, Private confidentiality, and
   backup status;
6. retain the previous API/static release for rollback.

No Docker is required. A local PostgreSQL process is valid, but external
PostgreSQL remains an acceptable alternative if it supports the required
transaction semantics and persistent LISTEN connection.

## 6. What not to rewrite

Do not needlessly rewrite:

- Closer wording, category names, relationship vocabulary, and icon/assets;
- `packages/ui` primitives and `packages/ui/src/styles/globals.css` tokens;
- category/mode presentation and semantic shared components;
- React Hook Form + Zod contracts and their user-facing validation copy;
- Question logical identity, revision pinning, intensity semantics, and Admin
  privacy formulas;
- the existing database constraint concepts;
- integration tests as behavioral references;
- SSE metadata-only event vocabulary;
- deterministic selection semantics, even if page buffering internals change.

Rewrite only Next-specific composition, Better Auth adapters, HTTP plumbing,
and server-rendering boundaries.

## 7. Main risks and mitigations

| Risk                                                  | Mitigation                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth regression/linking creates duplicate Participant | lock mapping, idempotent upgrade tests, preserve Participant FKs                                   |
| Candidate confidentiality leak                        | server projections, forbidden-field tests, never preload candidate for non-creator                 |
| Pair/conversation concurrency bug                     | preserve Pair locks and DB constraints; run two-client race harness                                |
| Lost idempotency                                      | carry every request ID and unique index; replay stored result                                      |
| History authorization mistake                         | authorize by membership/era IDs; test replacement and termination readers                          |
| SSE reconnect or cross-Pair leak                      | persistent listener tests, Pair registry tests, open/reconnect reconciliation                      |
| Admin privacy leakage                                 | aggregate in SQL with `HAVING count(distinct pair_id) >= 5`; return null bucket, not hidden counts |
| UI parity drift                                       | reuse tokens/components and run route/projection/visual checklist                                  |
| Scope explosion                                       | schema-near-unchanged rule, no RBAC/OAuth/Redis/microservices in V1                                |
| Vercel assumptions survive unnoticed                  | run only behind Caddy/systemd in staging before default switch                                     |
| Stale PWA entry                                       | fix `/new` vs `/create` during WEB-01 and add install smoke test                                   |

## 8. Final recommendation

1. Go + Vite is suitable if the API stays a persistent PostgreSQL-backed
   process; it is not suitable as a serverless/stateless port.
2. Keep chi/pgx/sqlc/slog, but use explicit transactions and a dedicated
   session-capable listener. Do not add Redis, GraphQL, or microservices.
3. Preserve the domain schema concepts, Participant/Pair/era boundaries,
   Question revisions, Private/Together semantics, design system, contracts,
   and tests.
4. Private candidate/confidentiality and concurrency is the highest-risk phase.
5. Relative effort: Private 30%, auth/lifecycle 20%, frontend 20%,
   Together 12%, Admin/analytics 10%, realtime/deploy 8%.
6. Build first: reviewed schema baseline + Go auth/actor resolution, then Pair
   and invitation boundaries, before any broad UI port.
7. Absolutely do not delete `apps/web`, `packages/db`, existing integration
   tests, the current auth tables, or the current Next APIs until CUTOVER-04.

## 9. Verification performed for REWRITE-00

- `git diff --check`: run after documentation creation.
- No `db:push`, migration, database reset, or destructive command is part of
  this audit.
- No Go/Vite implementation or runtime behavior change is part of this audit.
