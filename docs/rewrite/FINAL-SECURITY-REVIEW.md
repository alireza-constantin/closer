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
confirmed issues below. Existing Go integration and concurrency tests were
reviewed, but the PostgreSQL-backed tests skip without the isolated test URL.

The test harness only accepts `CLOSER_TEST_DATABASE_URL` pointing to loopback
database `closer_test`; it never falls back to `DATABASE_URL`. That variable and
`apps/api/.env.local` were absent. PostgreSQL was not listening on
`127.0.0.1:5435`, `pg_ctl` was unavailable, and Docker Desktop was unreachable.
No database connection, migration, reset, or production access was attempted.
This blocks the requested DB-backed proof and release sign-off.

Commands completed: focused and full Vite tests; Vite typecheck/build; workspace
typechecks/build; `go fmt ./...`; `go vet ./...`; `go test -p 1 -count=1 ./...`;
`go build ./...`; and `bun run api:test` / `bun run api:build`. The Go tests
without PostgreSQL passed. Integration tests requiring `closer_test` could not
run. SQLC v1.31.1 generation was run twice; the second output matched the first
by per-file SHA-256. Generated output differed from the checked-out worktree
only in line endings; no generated content diff remained after restoring those
line-ending-only changes.

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
  backoff; live reconnect/shutdown proof is blocked by unavailable PostgreSQL.
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

- **Release sign-off is incomplete.** No safe `closer_test` database was
  configured or available. Run migrations twice and rerun the full Go suite,
  including HTTP serialization, replacement-era, termination/rejoin race,
  invite race, Together, analytics, and listener integration tests against the
  isolated database before merge.
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

The two source-level fixes are tested. Do not treat this report as a full
pre-release security sign-off until the safe PostgreSQL/SQLC gates above pass.
The external temporary legacy environment backup still exists at
`F:\codes\Closer-local-backup\legacy-next-env\legacy-next-env.env`; it is not
used by the final runtime.
