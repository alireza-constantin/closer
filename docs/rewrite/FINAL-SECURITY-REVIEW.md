# Scope

SECURITY-01 reviews the final Go API, PostgreSQL, and Vite runtime on the
`security/final-review` branch. Production systems will not be accessed, and
the branch will not be pushed or deployed.

## Repository baseline

- Main and `origin/main` were clean and synchronized at
  `86b603e44a18119a6d01f10f28ae48ed3d0b432f` before the security worktree was
  created.
- `apps/web/` was classified as stale legacy Next.js residue. Git commit
  `d6b5139` removed the legacy runtime; the remaining tree contained only
  generated output, dependency installation data, generated Next tooling files,
  empty legacy source directories, and a local `.env`.
- The local `.env` was copied outside the repository to
  `F:\codes\Closer-local-backup\legacy-next-env\legacy-next-env.env` before
  the user removed `apps/web/`. Source and destination were 158 bytes and their
  SHA-256 hashes matched. The backup is not used by the final runtime and
  contains no reportable values.
- After the user removed `apps/web/`, repository status was clean. A fresh
  `git fetch --prune` confirmed `HEAD == origin/main ==
86b603e44a18119a6d01f10f28ae48ed3d0b432f`.
- The review worktree is `F:\codes\Closer-security`, created at that commit.

# Methodology

Reviewed the current Go + Vite runtime, HTTP route registration and middleware,
auth/session services and PostgreSQL adapters, Private and Together persistence
queries, migrations, realtime listener, frontend cache ownership, package
manifests, workspace configuration, and deployment files. Searched for unsafe
HTML sinks, redirect destinations, legacy runtime packages, secret exposure,
and sensitive HTTP cache policy. Added and ran focused regressions for the two
confirmed issues below. Existing Go integration and concurrency suites were
rerun against the isolated test database described below.

The test harness accepts only an explicit `CLOSER_TEST_DATABASE_URL` pointing
to loopback database `closer_test`; it never falls back to `DATABASE_URL`. For
this continuation, an isolated PostgreSQL 18.6 cluster was initialized outside
the repository at `F:\codes\Closer-security-data`, bound only to
`127.0.0.1:55435`, and configured for SCRAM-SHA-256. A dedicated
non-superuser `closer_test_user` owns the only database created, `closer_test`.
The URL is in ignored `apps/api/.env.local`. Guarded reset applied the baseline
migration once; guarded apply then reported zero pending migrations. No other
database was targeted.

The unrelated PostgreSQL service on port 5435 remained running (PID 6460) and
its existing data/configuration were not changed. At the end, only the isolated
cluster was stopped and port 55435 had no listener. The isolated data directory
is retained. Two setup scratch files outside the repositories remain as
zero-length files: the desktop safety review rejected their deletion, so their
generated credential contents were overwritten and verified empty.

Commands completed: `go fmt ./...`, `go vet ./...`,
`go test -p 1 -count=1 ./...`, `go build ./...`, `bun run api:test`, and
`bun run api:build`; all passed with the guarded database configured. The
focused Vite suite passed all 53 tests, Vite typecheck and production build
passed, and workspace typechecks/build passed. SQLC v1.31.1 generation ran
twice; both generated output manifests were unchanged, including between runs.
The Go race-detector run remains unavailable because this toolchain has
`CGO_ENABLED=0` and `go test -race` requires cgo.

## Database-backed verification results

- **SSE membership loss:** `TestRealtimeClosesAfterSubscriberLosesActiveMembership`
  passed and verifies that the route closes and sends no later Pair event after
  its access store reports lost membership. That route test uses a controlled
  in-memory access store. Pair-scoped registry fanout and subscription close
  tests passed; live PostgreSQL-backed SSE replacement, replacement reconnect,
  outsider, cross-Pair route, and terminated-Pair stream cases were not covered
  together by a test.
- **Replacement/rejoin and membership eras:** PostgreSQL tests passed for
  rejoin closing the old era, replacement isolation from old Private/Together
  state, old-era history concealment, and replacement inability to inherit or
  mutate old reactions/replies.
- **Private authorization and secrecy:** PostgreSQL tests passed for waiting
  candidate projections, viewer-relative answer projections, independent
  reveal, post-reveal reaction/reply/progression gates, and HTTP JSON answers
  remaining private until authorized reveal.
- **Private history:** outsider denial, malformed HTTP cursor rejection,
  cross-Pair cursor rejection, replacement-era isolation, keyset pagination,
  and frozen wording/display-name projections passed.
- **Termination and concurrency:** tests passed for idempotent termination,
  termination versus initial invite redemption, rejoin, Private mutations, and
  Together mutations, plus replacement versus progression and old-member
  reaction/reply access.
- **Invites:** tests passed for hash-only token persistence, explicit claim,
  concurrent same-invite redemption, revoke races, expiry recheck, single use,
  and rejection after termination.
- **Admin and sessions:** database tests passed for Admin isolation/bootstrap,
  denial of consumer promotion, session token hash-only persistence, logout
  revocation, expiry, and rate-limit concurrency. HTTP authorization tests
  passed for unauthenticated/consumer denial and Admin-only access.
- **Analytics privacy:** the PostgreSQL integration fixture passed the
  four-distinct-Pair suppression and five-distinct-Pair availability checks,
  including replacement eras not counting as a new Pair. HTTP tests verified
  suppressed JSON omits numerator, denominator, and rate.
- **LISTEN/NOTIFY:** commit delivery, rollback suppression, dedicated listener
  connection open/close lifecycle, Pair-scoped fanout, idempotent subscription
  cleanup, and event payload validation tests passed. Cancellation of the
  long-running listener loop itself was not separately exercised here.

No tests were skipped for lack of the isolated database URL during this run.
The remaining SSE route integration gap above is explicitly retained as a
verification limitation rather than inferred as a passing live-stream test.

# Findings

## SEC-01 — Existing SSE subscriptions outlived active membership

- **Severity:** MEDIUM
- **Affected area:** SSE / Pair authorization
- **Precondition:** A Pair member opens an authenticated event stream, then that
  member's active membership ends or is replaced while the connection remains
  open.
- **Vulnerable boundary:** The stream checked Pair access only when connecting;
  its existing subscription continued forwarding subsequent Pair invalidation
  metadata.
- **Impact and exploit path:** The former member could keep receiving metadata
  that activity had occurred in the Pair after losing current membership.
  Payloads did not contain question wording, answers, replies, reactions, or
  credentials, but the stream crossed the current-membership boundary.
- **Fix:** Recheck current Pair access before delivering each event. Close the
  stream when access is lost; preserve the existing terminal-event behavior for
  a Pair termination. Close after delivering a termination event as well.
- **Regression coverage:** `TestRealtimeClosesAfterSubscriberLosesActiveMembership`
  fails if the connection stays open or emits `pair.changed` after access ends.
  The focused test and full non-DB Go suite pass. A live PostgreSQL replacement
  test remains unverified.

## SEC-02 — Admin login retained the previous actor's query cache

- **Severity:** MEDIUM
- **Affected area:** Frontend actor/cache isolation
- **Precondition:** Consumer data is cached in the shared QueryClient and the
  same browser signs into Admin without first logging out.
- **Vulnerable boundary:** Successful Admin login replaced the session cookie
  and populated the Admin session key without clearing cached consumer data.
- **Impact and exploit path:** Cached private Pair data could remain in memory
  and be rendered by a subsequent route/view while the browser now used an
  Admin actor. This is a shared-browser actor transition issue.
- **Fix:** Clear the actor QueryClient cache before storing the successful
  Admin session. Use the same actor-cache clear helper on consumer logout,
  invite claim, and guest rejoin.
- **Regression coverage:** `query-client.test.ts` verifies former Private
  history and prior Admin analytics are removed while the new Admin session is
  retained. All Vite tests, typecheck, and production build pass.

No CRITICAL or HIGH finding was confirmed by the source-level review. The
severity assessment and coverage are limited by the missing safe PostgreSQL
environment.

# Verified invariants

- Session tokens are 32 random bytes; persistence uses SHA-256 token hashes.
  Cookie serialization uses HttpOnly, SameSite=Lax, root path, expiry, and
  Secure for trusted HTTPS origins. Idle and absolute expiry, renewal, and
  revocation are implemented in the auth service/store.
- Passwords use Argon2id (64 MiB, three iterations, parallelism one), random
  16-byte salts, constant-time comparison, bounded verification parameters,
  and a two-slot work limit. Login errors are generic; invalid-email timing is
  equalized. Password inputs are valid UTF-8 and 8–128 bytes.
- Login throttles are database-backed; consumer IP and normalized-email scopes
  are independent, and Admin attempts are IP-scoped. Forwarded client IP is
  considered only when the peer is in configured trusted proxy CIDRs; malformed
  chains fall back to the peer address. `Forwarded` is not trusted.
- Auth, invite, Pair, Private, Together, and Admin mutations check exact
  configured `Origin`; an empty origin allowlist fails closed. Admin
  authorization checks both `kind=admin` and an Admin row. Admin actors do not
  resolve to or create Participants.
- Invite and rejoin credentials are random and persisted as hashes. Preview
  handlers use read-only lookup paths. Redemption and replacement use
  transactional store boundaries; existing integration tests cover single-use
  and concurrent redemption, but were not run against PostgreSQL here.
- Private active reads and mutations consistently resolve active Pair access
  and include the current membership-era ID in Private conversation, Round,
  answer, reveal, reaction, reply, and candidate queries. History associates
  the viewer Participant with a membership in the Round's exact era and Pair;
  cursor contents are Pair ID, timestamp, and Round ID only.
- The current-Round projection returns only the viewer's answer before reveal;
  both answers/interactions are projected after reveal. History projects frozen
  display names and only completed Rounds after both answers and both reveal
  views. Existing serialized HTTP and replacement-history tests are present,
  but their DB-backed execution is unverified in this run.
- Pair termination and replacement code paths serialize through store
  transactions and emit post-commit invalidations. Together operations resolve
  current Pair access and their persisted session is Pair-scoped.
- Admin analytics SQL counts distinct Pair IDs, applies the five-Pair threshold,
  scopes explicit revision reads, and suppresses current metrics when any
  revision bucket falls below the threshold. Suppressed HTTP JSON tests verify
  metric operands are omitted.
- Sensitive auth, Private, invite/rejoin, Admin question, and Admin analytics
  responses use `private, no-store`; SSE uses `no-cache, no-store`. Static
  assets and app-shell caching are handled separately by the PWA policy.
- SSE event payloads are a versioned allowlist of Pair-scoped event type and
  metadata, not domain content. The listener uses a dedicated `pgx.Conn`, a
  fixed channel name, JSON payload validation, cancellation, and reconnect
  backoff. Database LISTEN/NOTIFY commit/rollback and listener connection tests
  passed; live SSE reconnect/shutdown behavior remains unverified.
- React output uses normal escaping; no `dangerouslySetInnerHTML`, `innerHTML`,
  `insertAdjacentHTML`, or custom HTML renderer was found. API client paths are
  same-origin and reject absolute, protocol-relative, and traversal paths.
- Request logs include route patterns and status metadata, not raw paths,
  query strings, bodies, or tokens. Client errors are generic. Database URL
  parsing errors are sanitized.
- Migration runner applies embedded ordered migrations with a session advisory
  lock, per-migration transaction and checksum tracking, and a schema verifier.
  The explicit test reset accepts only loopback `closer_test` and verifies the
  connected database. Migration apply/rerun was not run without that target.
- Go/Vite runtime manifests have no Next.js, Better Auth, Drizzle ORM, or Vercel
  runtime dependency. `next-themes` remains only as a UI-library peer used by
  the existing Sonner theme adapter; it is not the Next.js runtime.

# Residual risks

- **Release sign-off is incomplete.** Database-backed Go, API, migration, and
  concurrency gates passed on the isolated test cluster, but the full SSE
  replacement/reconnect/outsider/cross-Pair/terminated-stream matrix still
  lacks an HTTP route integration test against PostgreSQL. The current
  membership-loss route regression uses an in-memory access store.
- SQLC v1.31.1 produced identical content on consecutive generations.
- The new SSE membership recheck is per event, not transactionally locked
  through socket delivery. It prevents later events after the check observes
  replacement; an event already in flight across a concurrent replacement is
  bounded by the event's metadata-only payload. Verify this behavior with the
  database-backed replacement race suite.
- The targeted Go race-detector run could not start because this Go toolchain
  has `CGO_ENABLED=0` and `go test -race` requires cgo. The normal targeted and
  full Go tests pass.
- Unauthenticated anonymous-session issuance and registration are not
  rate-limited. No exploit was demonstrated in this pass; deployment-level
  request throttling is a reasonable abuse-control measure if public exposure
  warrants it.
- Browser multi-tab actor switching and deployed two-user behavior were not
  tested. The per-tab cache fix covers the Admin login transition in the same
  tab.

# Deployment-layer recommendations

- Terminate TLS at the trusted deployment edge and enable HSTS there after
  confirming all intended hosts are HTTPS-only.
- Configure exact production `CLOSER_TRUSTED_ORIGINS` and narrowly scoped
  `CLOSER_TRUSTED_PROXY_CIDRS`; ensure the edge overwrites incoming
  `X-Forwarded-For` values and does not expose the API directly around it.
- Configure static-host/API-edge headers: `X-Content-Type-Options: nosniff`, a
  suitable `Referrer-Policy`, and a frame-embedding restriction (`frame-ancestors`
  via CSP or `X-Frame-Options`). Add CSP only after validating the final Vite,
  PWA, and API deployment behavior; no brittle app-level CSP was introduced.
- Inject unique, least-privilege database credentials for runtime and migration
  identities; keep `DATABASE_URL` and listener credentials server-only. Vite
  currently exposes only `VITE_API_PROXY_TARGET`, which is a public dev proxy
  setting and must not contain a credential.
- Set log retention and access controls appropriate for account/session event
  metadata, and maintain encrypted, access-controlled database backups with a
  tested restore procedure.

## Review state

The two source-level fixes and the listed database-backed gates are tested.
Do not treat this report as a full pre-release security sign-off until the
remaining live SSE route integration matrix is verified.
The external temporary legacy environment backup still exists at
`F:\codes\Closer-local-backup\legacy-next-env\legacy-next-env.env`; it is not
used by the final runtime.
