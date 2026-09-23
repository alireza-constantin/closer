# Closer Admin V1 specification

> **Historical product and design reference.** Its Admin behavior decisions remain useful, but its legacy Next.js paths, Better Auth implementation notes, and setup guidance do not describe the shipped Go + Vite runtime. Use [the current Admin operator runbook](./ADMIN-RUNBOOK.md) and [analytics specification](./ADMIN-ANALYTICS.md) for release operations and current analytics privacy behavior.

**Historical status:** Admin V1 behavior and design were locked; legacy runtime details are superseded.

This is the canonical specification for Closer Admin V1 and the `PRIVATE-01`
consumer-domain dependency it requires. It records settled product and
architecture decisions; it does not authorize implementation by itself.

## Scope and non-goals

Admin V1 is an internal, desktop-first product for curating Questions, working
with immutable Question Revisions, operating Question lifecycle controls, and
reviewing privacy-preserving catalog analytics. It answers whether Questions
are useful; it never exposes what a particular Pair or Participant said.

V1 excludes RBAC, public Admin discovery, standalone cross-catalog analytics,
date-range controls, quality scores/rankings, exhaustion analytics, hard delete,
historical emergency removal, and a generic event or analytics warehouse.

## Admin identity and access

- Admin login is `/admin/login`; it has no consumer-facing link and is not a
  security boundary.
- Authentication reuses Better Auth email/password. Admin is a dedicated
  Better Auth account and must never become a consumer Participant.
- Authorization is `ADMIN_USER_ID`. `requireAdmin()` succeeds only for a valid
  Better Auth session whose `session.user.id` exactly equals that value.
- Every `/admin/*` surface and every `/api/admin/*` read or mutation enforces
  Admin authorization independently. Admin authorization must not resolve a
  Participant or require consumer onboarding.
- Admin writes use `/api/admin/*` Route Handlers. A handler authorizes, checks
  trusted origin/CSRF, parses a Zod contract, invokes a server/domain module,
  and maps its result. Protected Server Components and server projections serve
  reads; URL search parameters hold table/filter state where practical.

### Bootstrap and recovery

Initial provisioning is the manual `bun run admin:bootstrap` command using the
server-only `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` values.

- It never runs during deployment.
- It creates only a missing dedicated Admin account with Better Auth-compatible
  credentials, prints its user ID, and requires an operator to configure
  `ADMIN_USER_ID`.
- A rerun is a no-op only when the account for `ADMIN_BOOTSTRAP_EMAIL` exactly
  matches configured `ADMIN_USER_ID`. Every other existing-email case fails
  without mutation, promotion, or password reset.
- Remove `ADMIN_BOOTSTRAP_PASSWORD` from production configuration after the
  initial provision.

Recovery is a separate privileged command. It targets only configured
`ADMIN_USER_ID`, uses Better Auth-compatible password handling, and revokes
existing Admin sessions. It cannot reset arbitrary accounts.

### Release security requirements

- Database-backed, request-based limiting of Admin sign-in to five attempts per
  minute per IP; do not use a global account lockout.
- Better Auth trusted-origin and CSRF protection remain enabled.
- Admin has an explicit logout action.
- `ADMIN_USER_ID`, bootstrap, recovery, and authorization paths have
  integration coverage.

## Question and revision model

A **Question** is stable logical identity. A **Question Revision** is one
immutable exact wording and eligibility record. Revision-owned fields are text,
category, relationship fit, mode fit, and intensity. Changing any of them
creates a new Revision.

Private candidates, Private Rounds, and Together shown-question occurrences
pin exact Revisions. Normal editing therefore affects future selection only;
an already-offered Private candidate remains pinned until Ask, Skip, or
Withdrawal.

### Creation, activation, and revision order

Creating a Question creates the Question, Revision 1, its current-revision
pointer, and `is_active = false`. It is an **Inactive Question**, not a Draft:
there is no Draft lifecycle. First publication requires `activated`.

Creating a later Revision retains the logical Question's Activity. An Active
Question remains Active; an Inactive Question remains Inactive.

Every Revision receives a durable per-Question ordinal (`v1`, `v2`, ...), with
conceptual uniqueness on `(question_id, revision_number)`. Existing revisions
are backfilled per Question in `created_at ASC, id ASC` order. Their Admin
actor remains null and displays as **Pre-Admin catalog**; never fabricate
historical editorial facts.

The database must enforce that `question.current_revision_id` belongs to that
same Question. The precise PostgreSQL/Drizzle migration shape is an
implementation decision, but application-only enforcement is insufficient.

### Edit, restore, and conflict handling

Every create/edit/restore form supplies `expectedCurrentRevisionId`. If the
current Revision changed since the form loaded, the mutation returns `409
Conflict`; the Admin UI requires review of the latest Revision before retrying.
Last-write-wins is prohibited.

Restore never moves the current-revision pointer backwards. **Restore v2**
copies v2 content and metadata into a new later Revision, which becomes current.

On Create and New Revision, warn on normalized exact wording matches (trim,
collapse whitespace, case-insensitive). The warning links to matches but is not
a uniqueness constraint or fuzzy-match system; an Admin may proceed.

## Lifecycle and editorial accountability

Activity and Revision health are independent Admin facets:

| Facet           | Values                           |
| --------------- | -------------------------------- |
| Activity        | Active, Inactive                 |
| Revision health | Safe, Current revision withdrawn |

**Blocked from activation** is derived UI state, not a persisted status enum.
An Inactive Question with a withdrawn current Revision cannot activate until a
safe replacement Revision exists.

Editorial lifecycle history is narrow and append-only. Each record has a
Question target, optional Revision target, Admin actor, timestamp, and optional
reason. Its actions are:

- `activated`: the first inactive-to-active publication;
- `reactivated`: inactive-to-active after a prior deactivation;
- `deactivated`: active-to-inactive;
- `revision_withdrawn`: a Revision safety withdrawal.

Withdrawal requires a reason; other reasons are optional. Revision creation is
represented by the Revision record and is not duplicated into lifecycle history.

### Deactivate, reactivate, and withdraw

Deactivation stops future selection and does not rewrite history or invalidate
an already-pinned occurrence. Reactivation restores only logical Question
activity, and only when the current Revision is safe.

Withdrawal is the emergency content-safety action. It may target any Revision,
is irreversible and idempotent in V1, and preserves the first withdrawal actor,
time, and reason. It excludes that Revision from future selection and
immediately invalidates unresolved Private candidates that pin it. The existing
transactional invalidation behavior is preserved.

Already-Asked/historical Private and Together content keeps its existing
authorization and visibility rules. Historical emergency content removal is a
separate deferred moderation policy.

There is no hard delete in V1. Deactivate for routine curation; withdraw a
Revision for safety. A future never-published-Draft deletion path requires a
real Draft model first.

## PRIVATE-01: consumer-domain dependency

Private candidate Skip and Like are consumer-domain behavior, not Admin-only
analytics instrumentation. `PRIVATE-01` makes candidate outcomes:

```text
unresolved | asked | skipped | invalidated
```

- Skip is creator-only, terminal, mutually exclusive with Ask, atomically sets
  `resolved_at`, and permanently consumes the logical Question in that Private
  Conversation, including future Revisions.
- Skip accepts `clientRequestId`. A retry returns the same next candidate or
  exhausted result and never consumes another Question.
- Like is creator-only and toggleable only while unresolved. Its final state is
  a nullable `liked_at` (or repository-consistent equivalent): null is off and
  a timestamp is on.
- Ask, Skip, and invalidation freeze Like. There is no post-resolution toggle
  or generic Like-event history.
- Invalidated candidates retain internal state where needed but are excluded
  from quality/conversion analytics.

This specification is intentionally consistent with the root glossary's
Private Skip, Private question Like, and Consumed Private question terms. ADR
003's 2026-09-20 creator-owned candidate-control amendment establishes the
same active rule.

## Analytics, privacy, and inventory

Admin V1 is **All Time only**. Analytics default to the current Revision; a
specific historical Revision is selectable, and **All revisions — historical
aggregate** is explicitly historical rather than current-wording performance.
The canonical formulas and source fields are in
[ADMIN-ANALYTICS.md](./ADMIN-ANALYTICS.md).

Quality metrics require at least five distinct contributing Pairs per displayed
bucket. Below that threshold, show **Insufficient data** and expose neither
count, rate, numerator, nor denominator. Admin V1 never exposes Pair,
Participant, Session, occurrence, answer, reply, sentiment, compatibility, or
relationship-score drilldowns.

Inventory is an operational lane of `category × relationship × mode`.
Intensity is a diagnostic breakdown because selection falls back across
intensities. Current eligible inventory requires an active Question, safe
current Revision, matching category/relationship/mode eligibility. Thresholds
are application constants:

| Eligible Questions | Health   |
| ------------------ | -------- |
| 0–5                | Critical |
| 6–11               | Low      |
| 12+                | Healthy  |

**Category: Deep** and **Intensity: Deep** are distinct concepts. Never render
bare **Deep** where both dimensions appear.

## Admin information architecture

V1 routes are:

- `/admin/login`
- `/admin` — Overview / Needs Attention
- `/admin/questions` — Questions workspace
- `/admin/questions/new` — Create Question
- `/admin/questions/[questionId]` — Question Detail

New Revision uses appropriate route/state; V1 has no standalone
`/admin/analytics` route.

The Questions workspace has shared Search, Category, Intensity, relationship
fit, mode fit, Activity, and relevant Revision-health filters. It has focused
views rather than a combined metric table:

| View       | Primary information                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Operations | Question, category, intensity, relationship/mode fit, activity, revision health, current revision, last change |
| Private    | Valid Offers, Decisions, Decision/Ask/Skip/Like rates                                                          |
| Together   | Shown, Decisions, Continue/Skip/Like rates                                                                     |

Question Detail exposes logical identity, current wording and ordinal, facets,
eligibility, revision history, scoped analytics, and editorial activity.
Revision history shows its exact wording/metadata, timestamp, known actor or
Pre-Admin label, current/withdrawn markers, and permitted withdrawal actions.

Create/New Revision is a dedicated screen. It includes wording, Category,
Intensity, relationship fit, mode fit, duplicate warning, stale-edit state,
restore source when applicable, and clear copy that Create makes an Inactive
Question while New Revision preserves Activity.

Overview shows only critical/low inventory lanes, Questions with withdrawn
current Revisions, and recent editorial activity. It does not make quality
judgments or show vanity totals.

## Mockup contract

The desktop Admin mockup has exactly five primary screens:

1. Overview / Needs Attention
2. Questions — Operations
3. Questions — Private or Together analytics
4. Question Detail
5. Create / New Revision

Admin Login may be designed separately and does not replace a primary screen.
The visual system is information-dense but calm and recognizably Closer: warm
cream/off-white surfaces, deep navy typography, coral primary accent, yellow
Fun, blue Deep Category, mint Memories, soft rounded surfaces, and subtle
organic personality. Avoid generic gray enterprise dashboards, dark sysadmin
styling, stretched consumer mobile cards, gamification, AI, chat, and social
feed patterns.

## Implementation plan

Future `.scratch/admin-v1/` tickets use this dependency order. Each ticket
must record Goal, Scope, Likely files, Domain invariants, Security requirements,
Tests, Acceptance criteria, and Migration.

### PRIVATE-01 — Candidate Skip and Like

- **Goal:** complete intended consumer candidate behavior and its authoritative
  domain facts.
- **Scope:** candidate state, `resolved_at`, final Like, idempotent Skip,
  logical-Question consumption, projections, and tests.
- **Likely files:** `packages/db/src/schema/closer.ts`,
  `packages/db/src/closer.ts`, Private contracts/routes/features, and Private
  integration tests.
- **Domain invariants:** creator-only mutation; exactly one Ask/Skip terminal
  result; a skip cannot re-offer the logical Question.
- **Security:** authorized current creator only; no candidate visibility leak.
- **Tests:** retry/race, consumption, Like freeze, invalidation, and projection
  confidentiality.
- **Acceptance:** all locked Private candidate rules hold.
- **Migration:** Yes.

### ADMIN-01 — Admin identity and security foundation

- **Goal:** establish a dedicated, defensible Admin access boundary.
- **Scope:** bootstrap/recovery commands, `requireAdmin`, logout, durable rate
  limiting, and environment validation.
- **Likely files:** auth package, web server auth/http modules, auth routes,
  package scripts, and environment contracts.
- **Domain invariants:** Admin is not a Participant; only `ADMIN_USER_ID` is
  authorized.
- **Security:** origin/CSRF checks, session revocation on recovery, five
  requests/minute/IP, no account lockout.
- **Tests:** bootstrap no-op/failure semantics, recovery target restriction,
  unauthorized route rejection, and rate-limit behavior.
- **Acceptance:** all Admin routes can independently prove access control.
- **Migration:** Yes (durable rate-limit storage if Better Auth schema requires it).

### ADMIN-02 — Revision integrity and editorial history

- **Goal:** make revision order, ownership, and editorial state durable.
- **Scope:** ordinals/backfill, pointer integrity, Admin actor fields, and
  lifecycle history.
- **Likely files:** DB schema, migration, domain operations, and integration
  tests.
- **Domain invariants:** pointer belongs to Question; revision order only moves
  forward; no fabricated Pre-Admin actor.
- **Security:** lifecycle actor is derived from authorized Admin identity.
- **Tests:** deterministic backfill, integrity rejection, action sequence, and
  immutable first withdrawal facts.
- **Acceptance:** all historical and new revision records are explainable.
- **Migration:** Yes.

### ADMIN-03 — Catalog domain operations

- **Goal:** implement safe editorial commands.
- **Scope:** inactive create, activate/reactivate/deactivate, new Revision,
  restore-as-new-Revision, idempotent Withdrawal, duplicate warning support,
  and conflicts.
- **Likely files:** DB domain module, Admin server module/contracts, routes,
  and integration tests.
- **Domain invariants:** normal edit preserves pinned candidates; withdrawn
  current Revision blocks activation; no hard delete.
- **Security:** commands require Admin identity and record actions.
- **Tests:** 409 editing, lifecycle combinations, old-revision Withdrawal, and
  restore semantics.
- **Acceptance:** every lifecycle action has one canonical domain transition.
- **Migration:** No (depends on ADMIN-02).

### ADMIN-04 — Admin APIs and read projections

- **Goal:** establish protected HTTP contracts and read models.
- **Scope:** `/api/admin/*`, Zod contracts, error mapping, list/detail/filter
  projections, and protected Server Component reads.
- **Likely files:** `apps/web/src/contracts`, `apps/web/src/server`,
  `apps/web/src/app/api/admin`, and Admin route components.
- **Domain invariants:** projections receive authorized, derived state only.
- **Security:** every endpoint authorizes; no consumer content projection.
- **Tests:** authorization, contract validation, filtering, and 409 mapping.
- **Acceptance:** UI can consume stable, minimal Admin DTOs.
- **Migration:** No.

### ADMIN-05 — Five-screen operational UI

- **Goal:** ship the locked operational and authoring workflows.
- **Scope:** Overview shell, three Questions views, Detail, and dedicated
  Create/New Revision screen with empty analytics layouts.
- **Likely files:** Admin route-local components, shared Closer presentation
  components where real reuse exists, and UI tests.
- **Domain invariants:** UI displays facets, not a generic status; authoring
  communicates inactive creation and preserved Activity.
- **Security:** no protected data enters client payloads unnecessarily.
- **Tests:** core navigation, forms, duplicate warning, and conflict state.
- **Acceptance:** all five mockup workflows are represented.
- **Migration:** No.

### ADMIN-06 — Analytics and privacy suppression

- **Goal:** deliver current-Revision quality metrics without privacy leakage.
- **Scope:** aggregated Private/Together projections, five-Pair suppression,
  revision selector, and historical aggregate labelling.
- **Likely files:** Admin server projections/contracts, Analytics UI sections,
  DB aggregation tests.
- **Domain invariants:** metrics join pinned revision IDs, never mutable current
  revision for historical rows; invalidated candidates are excluded.
- **Security:** suppress every hidden metric component below threshold; no
  drilldowns.
- **Tests:** formulas, revision grouping, thresholds, and absence of identifiers.
- **Acceptance:** analytics exactly match `ADMIN-ANALYTICS.md`.
- **Migration:** No (requires PRIVATE-01).

### ADMIN-07 — Inventory and operational Overview

- **Goal:** surface deterministic catalog needs.
- **Scope:** lane inventory, critical/low thresholds, withdrawn-current alert,
  and editorial activity feed.
- **Likely files:** Admin projections/components and tests.
- **Domain invariants:** inventory uses current eligible content and intensity is
  diagnostic only.
- **Security:** no activity identifies consumer behavior.
- **Tests:** lane arithmetic, thresholds, and alert content.
- **Acceptance:** Overview contains no quality judgment or vanity KPI.
- **Migration:** No.

### ADMIN-08 — Release verification

- **Goal:** validate V1 as a secure, accessible, operable product.
- **Scope:** security, migration, performance, accessibility, and release
  verification.
- **Likely files:** tests, deployment/runbook documentation, and targeted
  performance checks.
- **Domain invariants:** all preceding invariants remain true under release
  conditions.
- **Security:** authorization, rate limits, CSRF/origin, recovery, and privacy
  suppression are exercised end-to-end.
- **Tests:** migration upgrade, auth/access matrix, accessibility, and query
  regression coverage.
- **Acceptance:** release checklist is green with no known privacy exposure.
- **Migration:** No (verifies earlier migrations).
