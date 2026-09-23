# Closer parity checklist

This is the cutover gate. Each item is a behavioral assertion against the
current implementation. `MUST PORT` means it blocks making Go authoritative.

## 1. Schema and identity

- [ ] MUST PORT: `participant.id` remains stable and distinct from auth user ID.
- [ ] MUST PORT: onboarding trims and bounds display names; duplicate names are
      allowed; onboarding is idempotent.
- [ ] MUST PORT: every occurrence pins `question_revision_id` while no-repeat
      consumption uses logical `question_id`.
- [ ] MUST PORT: current revision composite ownership is enforced by the DB,
      not only by application code.
- [ ] MUST PORT: all partial unique indexes and content/lifecycle checks in
      `packages/db/src/schema/closer.ts` have equivalent constraints.
- [ ] MUST PORT: no hard delete path exists for Questions or editorial history.

## 2. Pair and invitation parity

- [ ] MUST PORT: Pair creation occupies slot one, requires a trimmed intended
      name and valid Partner/Friend relationship, and does not issue an invite.
- [ ] MUST PORT: `creationRequestId` retry converges to one Pair.
- [ ] MUST PORT: only explicit Invite/Connect issues a credential; issue/reuse
      never silently rotates a valid token.
- [ ] MUST PORT: raw invite appears only to the issuing browser; DB stores only
      a token hash; other devices see existence and expiry only.
- [ ] MUST PORT: explicit replacement revokes the old usable token and creates
      exactly one new token.
- [ ] MUST PORT: initial claim is explicit, single-use, slot-2-only, unexpired,
      non-self, non-duplicate-Pair, and serializes with termination.
- [ ] MUST PORT: successful claim clears intended name, creates first era, ends
      pre-claim Together, and grants no pre-claim history.
- [ ] MUST PASS BEFORE CUTOVER: rejoin is distinct from initial claim, targets
      only an anonymous member without an active session, and rebinds a fresh
      auth identity to the existing Participant.
- [ ] MUST PASS BEFORE CUTOVER: successful rejoin preserves the exact
      Participant ID, membership ID, logical slot, current era, and Pair; it
      creates no Participant, membership, or era and revokes obsolete sessions.
- [ ] MUST PORT: replacement remains a separate lifecycle: it ends the old
      membership/era, freezes display name, invalidates candidates, ends
      Together, and creates a new Participant and era when authorized.
- [ ] MUST PORT: termination is irreversible, idempotent, Pair-locked, and
      closes active authority without deleting historical rows.

Canonical tests:

- `packages/db/src/closer.integration.test.ts`
  - stable onboarding and concurrent identity resolution;
  - Pair creation and `clientRequestId` retry;
  - invitation issuance/reuse/replacement/hash-only behavior;
  - claim, duplicate Pair rejection, self-claim rejection, expiry/revocation;
  - claim serialization and unrelated Pair authorization;
  - rejoin link slot binding and multi-space behavior.
- `packages/db/src/rejoin-replacement.integration.test.ts`
  - atomic old-era/new-era replacement;
  - concurrent replacement vs Pair-scoped mutations;
  - former-era history and pre-claim Together history.
- `packages/db/src/pair-termination.integration.test.ts`
  - claim/replacement/termination commit-order races;
  - committed activity retained and later activity rejected.

## 3. Private state machine

### Candidate stage

| Before                                                    | Actor/command                          | Allowed     | Mutation/result                                                                                        | Visibility/event                                                                      |
| --------------------------------------------------------- | -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| no active Conversation                                    | either complete member starts category | yes         | one `(Pair,era,category)` Conversation; creator is first creator                                       | creator gets candidate or ready state; other gets waiting; `private.changed`          |
| unresolved candidate                                      | creator Ask                            | yes         | candidate `asked`, `resolved_at`; numbered Round with exact revision                                   | both see Round question; no candidate remains; `private.changed`                      |
| unresolved candidate                                      | non-creator Ask                        | no          | none                                                                                                   | 404/400 equivalent; never disclose candidate                                          |
| unresolved candidate                                      | creator Skip + UUID request            | yes         | candidate `skipped`, logical Question consumed, no Round, next candidate persisted; retry replays same | only creator sees next candidate; `private.changed` after route command if configured |
| unresolved candidate                                      | creator Like/unlike                    | yes         | nullable final `liked_at` toggle                                                                       | creator only; no consumption                                                          |
| asked/skipped/invalidated                                 | any candidate action                   | no          | none; Like frozen                                                                                      | no candidate projection                                                               |
| unresolved pinned withdrawn / era ended / Pair terminated | system boundary                        | invalidates | candidate invalidated, not consumed as asked/skipped                                                   | never user-visible candidate                                                          |

### Round stage

| Before                             | Actor/command                     | Allowed | Mutation/result                                                              | Visibility                                                       |
| ---------------------------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| open, no own answer                | either member Answer              | yes     | one immutable answer; first answer commits provisional Round under Pair lock | viewer sees own answer only; other answer absent                 |
| open, own answer exists            | same member Answer different body | no      | `ANSWER_IMMUTABLE` 409                                                       | unchanged                                                        |
| open, 0 answers                    | either member Decline/Retire      | yes     | status `retired`, actor/time; Round number remains                           | lone/no answer rules preserved; no Reveal/reaction/reply         |
| open, 1 answer                     | unanswered member Decline         | yes     | terminal retired                                                             | answer visible only to author; declined history                  |
| open, 1 answer                     | answer author Decline             | no      | none                                                                         | unavailable                                                      |
| open, 2 answers                    | either Decline                    | no      | none                                                                         | Reveal required                                                  |
| open, 2 answers, viewer not viewed | viewer Reveal                     | yes     | insert viewer Reveal View                                                    | only after this viewer's action can that viewer see both answers |
| both answers + viewer Reveal       | viewer reaction/reply             | yes     | upsert/delete own reaction/reply                                             | both answers and post-reveal content for authorized viewer       |
| both answers + only creator Reveal | creator progression               | no      | no automatic advance; creator cannot continue                                | creator waits for other Reveal                                   |
| both Reveal Views                  | creator continue/category entry   | yes     | next creator candidate in same Conversation                                  | non-creator waits; candidate confidential                        |

P-04 fixes progression on an explicit `POST /private-rounds/:roundId/progress`
command. The exact completion transition is the transaction that inserts the
second Reveal View and changes the Round from `open` to `completed`; the
Pair-wide open-Round guard remains held until that commit. Declined/retired
Rounds remain terminal and allow only the creator to begin the next candidate
without Reveal, matching the P-03 Decline rule.

| Before                 | Actor/command                        | Allowed    | Mutation/result                                                            | Visibility                                                |
| ---------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| one Reveal View        | creator progress                     | no         | none                                                                       | Reveal completion required                                |
| completed Round        | non-creator progress                 | no         | none                                                                       | creator remains sole progression authority                |
| completed Round        | creator Ask another                  | yes        | stable request ID selects one same-lane candidate or canonical exhaustion  | no automatic Ask; non-creator receives waiting projection |
| completed Round        | creator Something else + chosen lane | yes        | pair-locked lane transition and one target-lane candidate or waiting state | lane stays sticky until this explicit action              |
| completed Round        | creator retries same request ID      | yes        | replay stored action/candidate/exhaustion                                  | no duplicate candidate or skipped Question                |
| completed Round        | Ask another races Something else     | serialized | one action is recorded for the Round; competing action conflicts           | never create candidates in both lanes                     |
| completed Round        | creator Leave it here                | yes        | UI navigation only; no domain write                                        | completed Round remains in its Conversation               |
| retired/Declined Round | creator progress                     | yes        | same-lane continuation; no Reveal, reaction, or reply is enabled           | lone answer remains author-only                           |

Reaction and reply rows are scoped to `(Round, membership, membership era)`.
Reaction writes replace the previous value; DELETE removes it. Replies are
trimmed, editable, removable, and limited to 500 Unicode characters. Every
successful post-reveal mutation emits only metadata in `private.changed` after
commit.

The active projection states are `CURRENT_ROUND`, `CANDIDATE`,
`WAITING_FOR_CREATOR`, `READY_FOR_NEXT`, and `EXHAUSTED`. The current route
`hideUnviewedReveal` additionally removes answers/reactions/replies from a
`REVEAL_READY` response.

### Private selection and history

- [ ] MUST PORT: Private ramp prefers Light at 0–1 mutually completed rounds,
      Medium at 2–3, Deep at 4+; fallback is Light→Medium→Deep,
      Medium→Light→Deep, Deep→Medium→Light.
- [ ] MUST PORT: only both answers plus both Reveal Views count as mutually
      completed; Like, Ask, Skip, Decline, one answer, one Reveal, reaction, and
      reply do not advance the ramp.
- [ ] MUST PORT: skipped and asked logical Questions remain consumed after later
      revisions; exhaustion does not cycle or restart.
- [ ] MUST PORT: replacement creates a new Conversation/creator/sequence and
      resets consumption/ramp.
- [ ] MUST PORT: former history filters by viewer membership IDs, uses frozen
      ended display names, and never grants replacement history.
- [ ] MUST PORT: terminated-history visibility follows the same answer and
      reveal boundary documented by ADR 005; fully answered-before-boundary rounds
      are readable to both former members even without prior Reveal.

Canonical tests: `packages/db/src/private.integration.test.ts` cases covering
both-slot readiness, category isolation, candidate confidentiality, answer
confidentiality, idempotent answer/Skip, logical consumption, withdrawal,
intensity, replacement, Decline, Reveal, reactions, replies, and progression;
`packages/db/src/pair-termination.integration.test.ts` for termination races.

## 4. Together parity

- [ ] MUST PORT: one member may start Together before claim; claim ends the
      pre-claim session and does not grant its history to the claimant.
- [ ] MUST PORT: relationship-compatible categories only; manual URL picker
      routes cannot bypass category authorization.
- [ ] MUST PORT: Start persists category, seed, first shown Question, and
      `clientRequestId` convergence.
- [ ] MUST PORT: selection pins exact revision and never repeats logical
      Question within one Session.
- [ ] MUST PORT: Next marks current `advanced_at` and inserts one next card;
      Skip also advances but marks `skipped_at`; Like toggles current card only.
- [ ] MUST PORT: Next transitions alone drive Light/Medium/Deep ramp at 0–1,
      2–3, 4+; Skip and Like do not.
- [ ] MUST PORT: concurrent Next/Skip and repeated request IDs commit one
      transition; stale current/next IDs reject safely.
- [ ] MUST PORT: End sets `ended_at`, repeat End is safe, later mutation is
      rejected; exhausted is distinct from manually ended.
- [ ] NICE TO HAVE: exact 20-item client buffering and prefetch timing may
      change if the persisted choice, ordering seed, fallback, and no-repeat result
      remain equivalent.

Canonical tests: `packages/db/src/together.integration.test.ts` and
`apps/web/src/features/together-session/components/together-playback.test.ts`.

## 5. Question/Admin parity

- [ ] MUST PORT: create Question + revision 1 atomically, inactive by default.
- [ ] MUST PORT: revision ordinal increases; edit does not mutate old revision;
      restore copies as a new later revision.
- [ ] MUST PORT: `expectedCurrentRevisionId` stale writes return 409; no
      last-write-wins.
- [ ] MUST PORT: exact duplicate wording warning trims, collapses whitespace,
      and ignores case; it never blocks creation.
- [ ] MUST PORT: activate/reactivate require a safe current revision; deactivate
      does not rewrite pinned occurrences.
- [ ] MUST PORT: withdrawal requires a reason, is idempotent preserving first
      actor/time/reason, excludes the revision from future selection, and
      invalidates unresolved Private candidates.
- [ ] MUST PORT: lifecycle events are append-only and identify Admin actor;
      pre-Admin rows display `Pre-Admin catalog`.
- [ ] MUST PORT: Admin projections expose no consumer identity, Pair, answer,
      reply, session, or occurrence drilldown.

Canonical tests: `packages/db/src/question-revisions.integration.test.ts`,
`apps/web/src/server/modules/admin-questions/*.integration.test.ts`,
`apps/web/src/app/api/admin/questions/admin-routes.test.ts`, and the Admin UI
editor/coverage tests.

## 6. Analytics and inventory parity

- [ ] MUST PORT: all-time only; current revision is the default; historical
      revision and all-revisions aggregate are explicitly labelled.
- [ ] MUST PORT: every metric bucket requires five distinct Pairs. Below five,
      return `insufficient_data` and no count, numerator, denominator, or rate.
- [ ] MUST PORT: Private Valid Offers = unresolved + asked + skipped;
      Decisions = asked + skipped; Decision Rate = Decisions / Valid Offers;
      Ask/Skip/Like rates use Decisions as denominator and invalidated rows are
      excluded.
- [ ] MUST PORT: Together Shown = shown occurrences; Decisions = advanced;
      Continue = advanced and not skipped; Skip = advanced and skipped; Like rate
      counts liked decided occurrences only.
- [ ] MUST PORT: inventory is current eligible Question count by
      category × relationship × mode; 0–5 critical, 6–11 low, 12+ healthy;
      intensity is diagnostic breakdown only.

Source of truth: `docs/admin/ADMIN-ANALYTICS.md` and
`apps/web/src/server/modules/admin-questions/admin-question-analytics.service.ts`.

## 7. Realtime parity

- [ ] MUST PORT: exact fixed event vocabulary and `{version:1,pairId,type}`
      payload.
- [ ] MUST PORT: one lazy listener per API process, Pair subscriber registry,
      reconnect backoff, heartbeat, abort cleanup, and no cross-Pair delivery.
- [ ] MUST PORT: SSE sends invalidations only; all content arrives via
      authorized JSON projections.
- [ ] MUST PORT: client reconnect/open performs reconciliation and invalidates
      only the affected React Query key prefix; termination closes the stream and
      navigates to Pair Home.

Canonical tests: `packages/db/src/realtime.test.ts`,
`apps/web/src/app/api/pairs/[pairId]/events/route.test.ts`, and
`apps/web/src/features/pair/components/pair-realtime-provider.test.ts`.

## 8. Test port matrix

| Category                 | MUST PORT                                                                                                                        | Nice-to-have                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Auth                     | anonymous session, onboarding, stable identity/linking, Admin access, bootstrap/recovery, rate limit                             | provider-specific Better Auth behavior    |
| Pair                     | creation, access, status, name edit, multi-space                                                                                 | exact Server Component redirect snapshots |
| Invite                   | issue/reuse/replace, hash-only, landing, claim race, duplicate Pair                                                              | QR SVG snapshots                          |
| Replacement              | slot binding, eligible guest, old-era closure, concurrent races, history                                                         | exact copy                                |
| Together                 | categories, start/claim, ramp/fallback, revision pinning, Next/Skip/Like/End, idempotency, authorization                         | page size/prefetch timing                 |
| Private                  | candidate secrecy, Ask/Skip/Like, logical consumption, rounds, answers, Decline, Reveal, reaction/reply, progression, exhaustion | animation/performance thresholds          |
| History                  | former-era projection, frozen names, termination boundary, pre-claim Together                                                    | visual snapshots                          |
| Admin                    | revision lifecycle, conflicts, withdrawal, duplicate warning, filters, actor labels                                              | desktop layout details                    |
| Analytics                | formulas, revision scopes, suppression, inventory                                                                                | query-plan snapshots                      |
| Realtime                 | payload validation, Pair fanout, reconnect, SSE heartbeat/open/abort, client invalidation                                        | browser EventSource timing                |
| Security/confidentiality | no candidate leak, no answer leak, no token leak, no unrelated Pair access, no admin consumer data                               | log redaction scans                       |

## 9. Black-box parity harness

PARITY-01 keeps the scenarios in [`scripts/parity/cases.ts`](../../scripts/parity/cases.ts)
and the adapter-neutral observation/normalization contract in
[`scripts/parity/model.ts`](../../scripts/parity/model.ts). Each case records
its gate, fixture preconditions, actor and operation sequence, expected results
and persisted facts, viewer-relative projection assertions, applicable
post-commit events, and links to the current Next oracle tests or canonical
contract. The catalog is deliberately data-shaped TypeScript rather than a
second domain model.

Run the foundation checks without opening a database:

```sh
bun test scripts/parity/model.test.ts
```

The current Next/TypeScript implementation remains the oracle. The catalog's
`sources` point to its existing domain, route, and UI tests. Cases without an
existing focused oracle test are still explicit parity requirements sourced
from the frozen contracts; they remain reference-only until an OLD adapter can
exercise them.

| Area                        | Mandatory catalog coverage | Current oracle references                                                                                                                                                                     |
| --------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth ownership              | `auth.*`                   | `packages/db/src/closer.integration.test.ts`, `packages/auth/src/admin-auth.integration.test.ts`, `apps/web/src/app/prefetch-safety.test.ts`, `apps/web/src/app/api/onboarding/route.test.ts` |
| Pair, invite, era           | `pair.*`                   | `packages/db/src/closer.integration.test.ts`, `packages/db/src/rejoin-replacement.integration.test.ts`, `packages/db/src/pair-termination.integration.test.ts`, invite route/prefetch tests   |
| Together                    | `together.*`               | `packages/db/src/together.integration.test.ts`, `packages/db/src/question-revisions.integration.test.ts`, Together playback tests                                                             |
| Private and confidentiality | `private.*`                | `packages/db/src/private.integration.test.ts`, `packages/db/src/pair-termination.integration.test.ts`, `packages/db/src/rejoin-replacement.integration.test.ts`                               |
| Admin and analytics privacy | `admin.*`                  | `packages/db/src/question-revisions.integration.test.ts`, `apps/web/src/server/modules/admin-questions/*.integration.test.ts`, Admin route tests                                              |
| Realtime                    | `realtime.*`               | `packages/db/src/realtime.test.ts`, SSE route tests, Pair realtime provider tests                                                                                                             |

`must-pass-before-cutover` is required for all Private confidentiality and race
cases, auth-to-Participant ownership, Pair/era authorization, and Admin
suppression. Only explicitly `nice-to-have` cases may be deferred. The
`private.waiting-projection-confidentiality` case enumerates every forbidden
candidate field; do not replace it with a screenshot or rendered-UI assertion.

The comparison preserves semantic differences. Adapters supply a stable alias
map for fixture IDs; timestamp, generated request ID, token, seed, and unordered
array normalization is opt-in by JSON Pointer on the specific case. Unknown
IDs, state values, action outcomes, and contract-significant order remain
comparable. `assertScenarioExpectations` checks expected action status/code,
persisted-state facts, projection omissions, and post-commit invalidations;
`compareObservations` then compares the normalized OLD and NEW observations.

At this stage the catalog and comparison primitives are runnable, but no OLD or
NEW adapters exist. Therefore the current Next oracle tests can be run as
references, while cross-runtime execution and cutover readiness remain
unverified. Do not report the parity gate as passed until both adapters run
every mandatory case against equivalent disposable fixtures, including
two-client races, and retain the normalized traces and state snapshots.

The eventual runner executes each scenario against both implementations with
the same logical fixture and command sequence:

Run both implementations against the same disposable PostgreSQL fixture and
the same command sequence:

```text
fixture -> authenticate actor(s) -> command -> normalized projection -> state digest
```

Normalize nondeterministic fields (UUIDs, timestamps, raw tokens, seed when
random) into stable placeholders. Compare exactly where possible:

- status/error code and HTTP status;
- actor-relative state tags and resource IDs within a test mapping;
- Question logical/revision IDs, position/number, candidate state;
- answer visibility and absence of forbidden fields;
- event type/pair scope, never event timing.

Use semantic assertions for display timestamps, hash values, deterministic
ordering when a seed differs, and JSON field ordering. Include race scenarios
with two concurrent clients and record commit order. A parity failure must
retain both normalized command traces and DB state digests for diagnosis.

## 10. Frozen custom-auth parity

- [ ] MUST PORT: final runtime has purpose-built Go auth and no Better Auth
      route, table dependency, runtime package, cookie adapter, or provider
      callback.
- [ ] MUST PORT: an anonymous `auth_user` is created only by explicit POST;
      root GET, public invite/rejoin GET, React Router loader, browser prefetch,
      SSE connect, and `/api/v1/me` never create auth/session/Participant rows.
- [ ] MUST PORT: auth identity remains distinct from Participant; an auth user
      can have no Participant and an Admin always has no Participant.
- [ ] MUST PORT: Go `auth_user.id` is UUID; `participant.auth_user_id` is a
      unique UUID FK with RESTRICT deletion. Legacy Better Auth text identity is
      legacy-only; no mapping/bridge exists and parity needs no shared DB rows.
- [ ] MUST PORT: anonymous credential upgrade preserves the same auth-user ID,
      Participant ID, memberships, Pair/history ownership, and valid sessions.
- [ ] MUST PORT: direct signup creates a registered auth user/session but no
      Participant; explicit onboarding creates exactly one Participant.
- [ ] MUST PORT: a browser that logs into another registered account never
      merges its anonymous Participant/data; its anonymous current session is
      revoked and the existing account gets a fresh session.
- [ ] MUST PORT: session token is opaque, random, cookie-only, hash-only in the
      DB, revoked server-side, and never reflected in JSON/logs/SSE. Expired and
      revoked sessions cannot authorize a request.
- [ ] MUST PORT: password handling is Argon2id with the frozen parameter,
      bounds, encoded hash, unique normalized email, and rehash-on-login policy.
- [ ] MUST PORT: unknown email, wrong password, disabled user, and
      non-credential identity produce the same `INVALID_CREDENTIALS` result.
- [ ] MUST PORT: consumer password-reset delivery is absent/deferred; Admin
      operator recovery can reset only an existing Admin and revokes only its
      sessions.
- [ ] MUST PORT: `admin_user` is the final authorization source. Bootstrap
      cannot promote an existing consumer; an Admin route independently rejects
      missing session, consumer session, and non-Admin registered session.
- [ ] MUST PORT: Admin login permits five durable attempts/IP/minute and denies
      the sixth across separate API connections. Consumer IP/email limits and
      trusted-proxy handling have integration tests.
- [ ] MUST PORT: every cookie mutation validates exact configured Origin; no
      wildcard credential CORS exists; missing Origin browser mutations fail.

## 11. Frozen lock/idempotency test matrix

For each row, tests must assert lock order, committed result, retry behavior,
and the listed event—not merely that concurrent requests eventually return.

| Case                                         | Required assertion                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| issue/reuse/replace vs issue/reuse/replace   | Pair first; one usable hash; explicit replace revokes exactly one predecessor; `pair.changed`                                              |
| claim vs terminate / claim vs Together start | Pair then invite/membership/era plus ordered-pair advisory lock; commit order decides; rejected claim leaves token usable where required   |
| replacement vs Private/Together/termination  | Pair then membership/era then child rows; no partially closed era and no new entrant historical access                                     |
| candidate start vs start / Ask vs Skip       | Pair then era/Conversation/candidate; one Conversation/one resolved result; no candidate field crosses actor boundary                      |
| Skip retry                                   | UUID request replay returns persisted next candidate or exhaustion without consuming a second logical Question                             |
| Like vs Ask/Skip                             | Like cannot mutate a resolved candidate and Ask/Skip cannot return an obsolete Like state                                                  |
| withdrawal vs unresolved candidate           | Question/revision first, affected candidates deterministically; first withdrawal facts survive; unresolved candidate cannot become a Round |
| first/second Answer vs Decline/termination   | Pair then Round; own answer immutable, only eligible Decline succeeds, and commit order defines former history                             |
| Reveal/reaction/reply/progression            | Pair then Round and viewer rows; two answers plus viewer Reveal required; both Reveal Views required for creator continuation              |
| Together Next/Skip/Like/End                  | Pair then Session/current occurrence; request ID/current-card checks converge and terminal session rejects later writes                    |
| revision stale edit                          | Question then current revision; expected pointer mismatch returns `STALE_REVISION` without a new revision                                  |

## 12. API/PWA/deployment parity

- [ ] MUST PORT: all final API routes are `/api/v1`; additive v1 changes are
      backward-compatible and a breaking change requires a new major path.
- [ ] MUST PORT: every non-success JSON response has stable machine code and
      request ID; raw SQL errors are never observable.
- [ ] MUST PORT: OpenAPI, generated TypeScript client, and contract tests have
      no drift; HTTP DTOs are not database row types.
- [ ] MUST PORT: production is same-origin static Vite + Go API. Vite dev CORS
      is explicit; Vercel transition and future Caddy both serve SPA deep links
      without routing `/api/v1` to `index.html`.
- [ ] MUST PORT: PWA starts at `/`; service worker caches versioned static assets
      only, does app-shell navigation fallback, waits for explicit update reload,
      and never caches authenticated JSON, SSE, writes, or offline domain state.
- [ ] MUST PORT: normal DB access can use Neon pooling, but realtime `LISTEN`
      uses a session-capable direct URL. Local and future VPS PostgreSQL require
      configuration changes only; no Neon API/hostname appears in domain code.
- [ ] MUST PORT: each API process has its own listener and subscriber registry;
      cross-instance PostgreSQL fanout works without Redis; slow SSE clients
      cannot block a committed command.

## 13. Schema and test-database cutover gate

- [ ] MUST PORT: while porting, Go tests use `CLOSER_TEST_DATABASE_URL` and
      refuse any database name other than exactly `closer_test`; integration
      tests use the new Go executable schema, isolated from legacy Next tables.
- [ ] MUST PORT: ordered `apps/api/db/schema/` bootstrap DDL is reproducible;
      its guarded reset command cannot target Development, Production, or a
      database other than local `closer_test`.
- [ ] MUST PORT: the Go-independent reviewed SQL baseline installs on a clean
      disposable database and reproduces every required domain constraint.
- [ ] MUST PORT: baseline replaces Better Auth tables with `auth_user`,
      `auth_credential`, `auth_session`, `admin_user`, and `auth_rate_limit`
      without redesigning Closer domain tables.
- [ ] MUST PORT: after baseline ownership moves to `apps/api/db/migrations`,
      no production path invokes Drizzle `db:push`.
- [ ] MUST PORT: Caddy exposes only HTTP/HTTPS; future PostgreSQL listens only
      on loopback, uses an application-specific role, and has a tested off-server
      backup/restore procedure.
