# Closer V1 Implementation-Gap Inventory

## Purpose and snapshot

This document compares the repository implementation inspected on 2026-09-12 with the authoritative contracts in [`PRD.md`](./PRD.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), and accepted ADRs. It is a planning inventory, not an alternative specification.

No gap in this inventory was implemented as part of the documentation pass. The working tree already contained unrelated application changes, so likely files identify ownership areas rather than authorizing edits.

## Recommended dependency order

```text
1. Participant onboarding boundary
   ↓
2. Pair fields and lifecycle foundations
   ├─→ 3. Membership-era and history identity
   ├─→ 4. Invitation/claim/replacement transitions
   └─→ 5. Pair termination

6. Logical Question revisions
   ↓
7. Era-scoped Private Conversation + candidate model
   ↓
8. Ask/Skip/Like + Decline + both-Reveal progression
   ↓
9. Deterministic intensity selection and Together boundary handling
   ↓
10. History projections, routes/UI, migrations, and complete test matrix
```

Schema design for these steps should be planned as one coherent migration sequence before feature routes are switched, so intermediate states do not create two conflicting sources of lifecycle truth.

## 1. Participant onboarding

- **Current behavior:** `resolveOrCreateParticipant` supports a Participant with no Pair at the domain level, and an integration test can create such a record. Product onboarding does not expose that boundary: Pair creation and invitation redemption resolve/create the Participant as part of those commands, and the root create form asks for the Participant display name together with Pair relationship data.
- **Required behavior:** Participant onboarding creates the stable Participant independently. A Participant may stop with zero Pairs; creating the first or another Pair is a later action that does not ask an existing Participant to redefine their own name.
- **Likely modules:** participant resolution in `packages/db/src/closer.ts`; auth/session-to-Participant mapping in `packages/auth/src/closer.ts` and `apps/web/src/lib/closer-server.ts`; root/onboarding routes and `apps/web/src/components/create-pair-form.tsx`; validation contracts.
- **Schema/migration:** Probably no new Participant table; possibly onboarding/completion state if routing cannot be derived from Participant existence. A data migration may be unnecessary if existing Participants are already valid.
- **Security/privacy importance:** High. Authentication must resolve one stable Participant, and onboarding must not create duplicates during retries or guest-to-registered linking.
- **Suggested order:** 1.
- **Blocking dependencies:** Confirm the existing Better Auth anonymous-session creation boundary and decide whether Participant existence alone represents completed identity onboarding.

## 2. Pair creation and intended-person name

- **Current behavior:** Pair creation accepts Participant display name and relationship type, creates slot-1 membership, and immediately issues an invitation. The Pair schema has no intended-person name or terminal state. The create form has no intended-person field. Relationship type is stored on Pair and has no visible edit command, but immutability is not expressed as an explicit lifecycle contract.
- **Required behavior:** Pair creation requires a trimmed 1–40 character intended-person name plus immutable Partner/Friend type, creates only the Pair and slot-1 membership, and issues no invitation. The sole member may edit the label while unclaimed. Claim clears it; unclaimed termination retains it for read-only context.
- **Likely modules:** Pair schema and migrations; `createPairForParticipant`; Pair projections; Pair POST contract; create form and Zod validation; Pair Home/unclaimed Space presentation.
- **Schema/migration:** Yes. Add intended-person storage and Pair terminal lifecycle fields or equivalent. Define check constraints and backfill policy for existing unclaimed Pairs without inventing a real person's identity.
- **Security/privacy importance:** Medium-high. The field must never be treated as Participant identity or retained secretly after claim.
- **Suggested order:** 2.
- **Blocking dependencies:** Migration/backfill decision for existing Pairs; Pair termination representation.

## 3. Invitation lifecycle

- **Current behavior:** `createPairForParticipant` calls `issueInitialInviteInTransaction` and returns a raw token. The Pair route stores it in an HttpOnly per-Pair cookie. The invite GET can redisplay a still-usable cookie token. However, every POST to issue calls the issuing function, which revokes all outstanding active invites before creating a new one; `InviteControls` labels this as create/make fresh and can auto-generate after a failed local lookup. The server has no first-class status-only projection with existence and expiry. There is no explicit replace command distinct from ordinary issue/reuse.
- **Required behavior:** Pair creation issues nothing. Explicit Invite/Connect or Private entry lazily creates or reuses one valid invitation. A device without the raw token sees existence/expiry but cannot recover it. Explicit warned Replace atomically revokes and creates; ordinary issue/reuse never silently rotates. Hash-only server persistence remains.
- **Likely modules:** initial-invite schema/indexes; invite issuing/status/revocation domain functions; Pair and invite route handlers; local token cookie helper; `invite-controls.tsx`, `connect-person.tsx`, Pair Home; invitation integration and route tests.
- **Schema/migration:** Likely yes for a database-enforced one-usable-invite invariant or equivalent lifecycle query/index; existing fields already support hashes, expiry, revocation, and redemption.
- **Security/privacy importance:** Critical. Silent rotation and ambiguous credential commands can invalidate shared links or create multiple authority paths.
- **Suggested order:** 4, after Pair creation/lifecycle foundations.
- **Blocking dependencies:** Pair active-state model; explicit API command semantics for get-or-create versus replace.

## 4. Initial claim contract

- **Current behavior:** The join landing exposes only the inviter's display name. The form always asks for a display name and then posts redemption. Domain redemption locks the Pair, prevents self-claim and occupied-slot claim, and atomically consumes a valid invitation. It does not clear an intended-person name, check for another active fully claimed Pair between the same unordered Participants, start an explicit/stable era boundary, or end active pre-claim Together Sessions.
- **Required behavior:** Landing shows inviter name, relationship type, contextual intended-person name, and the claimant's actual Participant name. Existing Participants retain their name. Explicit `Join space` is the only consuming action. Claim atomically performs duplicate-Pair validation, slot membership, invitation consumption, intended-name clearing, first-era start, and pre-claim Together closure. Any rejected claim leaves the invite valid.
- **Likely modules:** invitation landing/redemption functions; pair/membership queries; join route/page/form; Together session termination logic; claim concurrency tests.
- **Schema/migration:** Yes or likely, depending on Pair/era and intended-name representation; unordered active-Pair uniqueness may need normalized keys, locking strategy, or a database constraint.
- **Security/privacy importance:** Critical. This is an identity, authorization, credential-consumption, and cross-Pair uniqueness boundary.
- **Suggested order:** 4.
- **Blocking dependencies:** Intended-person storage, Pair terminal state, era identity, and unordered-Participant uniqueness design.

## 5. Membership era and guest replacement

- **Current behavior:** `pair_membership.started_at/ended_at` records slot occupancy. Rejoin redemption ends one membership and inserts another under a Pair lock. It does not freeze a display-name snapshot, identify/close the former membership configuration for Private/Together data, invalidate candidates, or end Together Sessions. Existing authorization mostly requires current active membership and therefore prevents many former reads entirely rather than providing bounded read-only history.
- **Required behavior:** A stable Pair membership-era/configuration identity bounds Private Conversations, candidates, Together Sessions, and history. Replacement atomically ends the old era/membership, freezes the name, closes Private content read-only, invalidates candidates, ends Sessions, creates the new membership/era, and grants the replacement no earlier history. Creator authority never transfers.
- **Likely modules:** membership and Pair schema; rejoin domain functions/routes; Private and Together domain records/queries; Pair/history projections; replacement tests.
- **Schema/migration:** Yes. At minimum add membership-end name snapshots and stable configuration linkage or an equivalent derivable identity. Conversation closure needs one authoritative representation.
- **Security/privacy importance:** Critical. Incorrect scoping can leak a former Participant's Private answers to a replacement.
- **Suggested order:** 3, before changing rejoin and Private behavior.
- **Blocking dependencies:** Choice of the smallest correct era representation and Conversation closure authority. The accepted contract intentionally leaves table-versus-derived representation open.

## 6. Pair termination and Former-Pair history

- **Current behavior:** Pair has no termination fields or termination command. Domain access helpers require active membership; there is no Former-Pair listing/read projection, end-name snapshot, unclaimed `End this space`, claimed `Unpair`, terminal mutation rejection, or atomic credential/Session shutdown.
- **Required behavior:** Either active member may irreversibly terminate. One idempotent transaction ends memberships, freezes names, revokes credentials, invalidates candidates, and ends Together Sessions. All later Pair mutations fail. Authorized read-only history remains, including unclaimed contextual name and the accepted Private answer visibility rules.
- **Likely modules:** Pair/membership schema and domain service; new termination route; Pair Home confirmation UI; credential, candidate, Together, Private, and history modules; access/error mapping; integration tests.
- **Schema/migration:** Yes. Terminal Pair state/time, name snapshots, and history/era linkage are required; no content deletion migration is authorized.
- **Security/privacy importance:** Critical. Partial termination could leave live credentials or mutation paths; overbroad history could leak answers.
- **Suggested order:** 5, after era/lifecycle primitives and before exposing history UI.
- **Blocking dependencies:** Era representation; former-history projection rules; coordinated mutation lock order.

## 7. Private Conversation model

- **Current behavior:** `private_conversation` is unique by active `(pair_id, category)` and has `created_by_participant_id` plus an unused/independent `ended_at`. `startOrResumePrivateConversation` locks the Pair and creates or returns the Conversation, but immediately creates/returns a Round. Creator is recorded but not used as an authorization role. Conversation identity is not membership-era-scoped.
- **Required behavior:** One Conversation per `(Pair, membership era, category)`, immutable creator, persistent navigation-only lifecycle, no generic Private Session, and automatic read-only closure at era/Pair boundary. Starting a new-era category creates a new Conversation and resets numbering/consumption/intensity.
- **Likely modules:** Private Conversation schema/indexes; start/resume and list projections; Private category route/page; Pair Home Conversation summaries; history queries; Private integration tests.
- **Schema/migration:** Yes. Add era/configuration identity and enforce era-scoped uniqueness. Remove or repurpose `ended_at` only if it becomes the single authoritative closure representation; do not leave two lifecycle clocks.
- **Security/privacy importance:** High. Creator and era scoping determine candidate authorization and replacement isolation.
- **Suggested order:** 7.
- **Blocking dependencies:** Membership-era representation and logical Question revisions.

## 8. Server-backed candidate model

- **Current behavior:** No candidate table/state exists. Eligible Private questions can be listed to either active member through a questions route. Category selection immediately chooses a Question and creates a Round. Selection is recalculated from current Question rows rather than returning one persisted unresolved occurrence.
- **Required behavior:** Persist exactly one unresolved candidate per Conversation progression point, pin its Question revision and deterministic selection context, expose it only to the immutable creator, and keep it stable across refresh/retry/device races. Era/Pair end or withdrawal invalidates it without a Round.
- **Likely modules:** new candidate persistence and relations; Private selection/domain commands; eligible-questions route removal or replacement; Private category/candidate pages/components; projections and tests.
- **Schema/migration:** Yes. Candidate occurrence, status/resolution, pinned revision, creator attribution, Like state, and uniqueness/idempotency constraints are needed.
- **Security/privacy importance:** Critical. A generic eligible-question endpoint or non-creator candidate payload violates creator-only confidentiality.
- **Suggested order:** 7, together with Conversation changes.
- **Blocking dependencies:** Conversation era identity, Question revision model, deterministic selector.

## 9. Ask, Skip, and Private question Like

- **Current behavior:** Private has no distinct Ask, candidate Skip, or candidate Like. The deprecated direct-round route still exists, and Conversation start/next creates a Round directly. Current Private selection considers only Round usage, so skipped candidates cannot be consumed.
- **Required behavior:** Creator-only idempotent Ask/Skip commands resolve one candidate mutually exclusively. Ask creates the next numbered Round; Skip consumes without a Round/number and selects another. Like toggles only while unresolved, remains creator-only/internal, freezes on resolution, and never affects selection or history.
- **Likely modules:** candidate/domain command layer; dedicated route handlers and API client; candidate UI; behavioral-event/content-feedback sink; authorization and race tests; removal of direct round-creation paths.
- **Schema/migration:** Yes, as part of candidate persistence and Conversation logical-question consumption.
- **Security/privacy importance:** High. Command races and incorrect role checks can expose or duplicate Questions and corrupt sequence state.
- **Suggested order:** 8.
- **Blocking dependencies:** Candidate model, immutable creator, Round numbering, logical Question identity.

## 10. Private Decline

- **Current behavior:** No Declined state or command exists. A Round remains waiting until both answers exist. Round numbering is derived from creation order rather than stored as an explicit stable number; post-answer reaction/reply logic assumes all terminally useful Rounds become reveal-ready.
- **Required behavior:** Either unanswered Participant may terminally `Pass this question` while fewer than two answers exist. Answer/Decline races serialize. Decline keeps its Round number and Asked count, permits no reveal/reaction/reply, preserves a lone answer only for its author, shows neutral immutable history, and lets the creator continue.
- **Likely modules:** Private Round schema/state; answer and new Decline domain commands/routes; Round projection/status mapping; Private Round UI and Pair Home summary; history; concurrency tests.
- **Schema/migration:** Yes. Persist stable Round number, terminal Decline state, internal actor/time, and constraints or transaction rules preventing incompatible answer/decline combinations.
- **Security/privacy importance:** Critical. A lone answer must never leak through Declined history or reveal projections.
- **Suggested order:** 8.
- **Blocking dependencies:** Candidate/Ask model, stable Round numbering, former-history projection.

## 11. Reveal progression

- **Current behavior:** The system stores independent Reveal Views and protects answers before both are persisted. However, `createNextPrivateRound` checks only that two answers exist and does not verify creator authority or both Reveal Views. The UI shows `Next question` to any Participant after their own reveal. Pair Home treats a Participant's own reveal view as ready to continue.
- **Required behavior:** Both answers make Reveal available, but only the immutable creator may progress, and only after both Participants have recorded Reveal Views. There is no timeout or override. The creator polls/waits after revealing first; the non-creator never selects the next candidate.
- **Likely modules:** next-candidate domain authorization/gate; Reveal View queries; Conversation/Pair Home projections; `private-round-screen.tsx`, `pair-home.tsx`, polling; routes and integration/UI tests.
- **Schema/migration:** Reveal View storage already exists; progression may require candidate/progression fields but not a separate global `REVEALED` column.
- **Security/privacy importance:** High. The current behavior violates immutable creator ownership and the sequential one-stack model.
- **Suggested order:** 8.
- **Blocking dependencies:** Creator enforcement, candidate model, Decline state.

## 12. Question identity and immutable revisions

- **Current behavior:** `question` is one mutable row containing text, category, fits, `depth`, and `is_active`. Private Rounds and Together shown records reference that row directly. Historical projections read its current values. Usage/no-repeat tracks the mutable row ID. There is no emergency withdrawal distinction.
- **Required behavior:** Stable logical Question plus immutable revisions. Any content/eligibility/intensity edit creates a revision. Candidates, Rounds, and Together occurrences pin revisions; consumption uses logical identity. Ordinary deactivation affects future selection only; withdrawal invalidates unresolved candidates, with Asked/history handling deferred.
- **Likely modules:** Question schema/seed/import path; selection and projections in `packages/db/src/closer.ts`; Private/Together occurrence schema; content-management commands when introduced; all related tests.
- **Schema/migration:** Yes, substantial. Split or otherwise model logical identity/revisions; backfill current Questions as initial revisions; update foreign keys while preserving shown/Asked history.
- **Security/privacy importance:** High for historical integrity; critical for withdrawal of unresolved unsafe content. Historical withdrawal behavior remains intentionally unresolved.
- **Suggested order:** 6, before candidate implementation and selection changes.
- **Blocking dependencies:** Migration/backfill strategy; moderation contract is not required for unresolved-candidate invalidation but is required before handling Asked/history withdrawal.

## 13. Intensity selection

- **Current behavior:** Metadata and APIs use `depth`. Private selection sorts by Conversation use, then Pair use, then ID and explicitly cycles after category exhaustion. Together selection prefers unused questions by session/pair usage but has no Light/Medium/Deep ramp. Selection is deterministic mainly by row ID, without an explicit stable scoped seed/context or band fallback contract.
- **Required behavior:** Rename the canonical field to `intensity`; apply soft Light/Medium/Deep preference ramps. Private advances only on both answers plus both Reveal Views. Together advances only on `Next`; Skip/Like do not. Apply exact fallback order, deterministic scoped ordering, logical no-repeat, no silent cycling, and later continuation when new Private content arrives.
- **Likely modules:** Question/revision schema; Private/Together selectors; Session/Conversation progression projections; API types currently exposing `depth`; UI types should stop surfacing intensity; seed content; deterministic tests.
- **Schema/migration:** Yes, alongside Question revisions. Progression can often be derived from persisted Round/Reveal and Session transition records, but stable selection context may require storage.
- **Security/privacy importance:** Low for confidentiality, high for deterministic product correctness and historical consistency. Intensity must remain internal to avoid unintended participant scoring/gamification.
- **Suggested order:** 9.
- **Blocking dependencies:** Immutable revisions, candidate persistence, stored Round numbering/Reveal Views, Together transition semantics.

## 14. Together membership-boundary handling

- **Current behavior:** Together Sessions and shown Questions are bounded and idempotent for start/advance, permit one active member, do not store answers, and avoid same-session repeats by Question row ID. They are not linked to a membership configuration. Initial claim and rejoin do not end active Sessions. Pair termination does not exist. Current selection may report no question only through generic unavailability behavior and does not implement the intensity ramp.
- **Required behavior:** Sessions bind to their starting membership configuration. Initial claim, guest replacement, and Pair termination atomically end pre-boundary active Sessions. Replacement/claim Participants receive no earlier Together activity. Races use first-commit semantics. Selection uses revision pinning, logical no-repeat, explicit exhaustion, and the Next-based intensity ramp.
- **Likely modules:** Together Session/shown-question schema; start/advance/end/select domain functions; claim/rejoin/termination transactions; Together routes/screens; history and integration tests.
- **Schema/migration:** Yes for era/configuration and revision linkage; possibly no separate ramp column if reliable transition history derives it.
- **Security/privacy importance:** High. Without membership scoping, replacement history or active-session continuation can cross an authorization boundary.
- **Suggested order:** 9.
- **Blocking dependencies:** Era identity, Pair termination, initial claim/rejoin transitions, Question revisions.

## 15. UI, routing, history, tests, and migrations

- **Current behavior:** The active-space selector and pair-scoped routes are partially present. The create UI combines identity and Pair creation, lacks intended-person name, and assumes creation returns an invitation. Join lacks full claim context. Private routes open a Round directly, expose no candidate/creator-wait/Decline/exhaustion states, and show Next to a viewer after their own Reveal. Pair Home and History do not implement the new lifecycle; no termination controls or Former-Pair route exist. Integration tests strongly cover existing invitation, Private confidentiality, and Together behavior but encode several obsolete transitions.
- **Required behavior:** Route/UI adapters reflect the authoritative states without duplicating server rules: independent onboarding, intended name, lazy invite status/reuse/replace, explicit contextual Join, candidate creator/non-creator surfaces, Ask/Skip/Like, Decline, both-Reveal waiting, exhaustion, navigation-only Private exit, termination confirmation, and read-only Former-Pair history. Migrations preserve current data without inventing claimant identity or rewriting history. Tests cover the complete authorization and race matrix.
- **Likely modules:** root/create/join/Pair/Private/Together pages; API routes under `apps/web/src/app/api`; Pair, invite, Private, Together, and spaces components; validation/API clients/polling hooks; database migrations/schema/domain functions; integration, route, and component tests.
- **Schema/migration:** Yes, across most preceding areas. Rollout likely needs additive schema, backfill, dual-read or coordinated cutover, constraint activation, and only then obsolete-column/path removal. Exact rollout strategy should be its own implementation plan.
- **Security/privacy importance:** Critical. UI concealment cannot replace server authorization; migration and compatibility paths must not expose answers or revive credentials.
- **Suggested order:** 10 for broad cutover, while adding focused tests alongside each earlier domain increment.
- **Blocking dependencies:** Every preceding domain/storage decision; resolved route-state contract for active versus Former-Pair reads.

## Obsolete behavior to remove during implementation

The following current paths or assumptions should be removed only when their replacements are tested and ready:

- Pair creation issuing and returning an initial invitation.
- Pair creation asking for the Participant's own display name instead of a separately onboarded identity plus intended-person name.
- Ordinary invite POST revoking a still-valid invitation and `autoGenerate` falling through to silent rotation.
- Join landing showing only inviter name and always treating display-name entry as claimant identity creation.
- Pair/category Conversation uniqueness without membership-era identity.
- Independent `private_conversation.ended_at` if era closure becomes authoritative elsewhere.
- Public-to-both-members eligible Private question listing.
- Category start and `Next question` directly creating a Round with no persisted candidate.
- Deprecated direct Private-round creation route/function.
- Either Participant being able to progress after two answers or their own Reveal View.
- Question cycling after Private exhaustion.
- Derived Round number based only on current creation order where Decline and stable numbering require an explicit invariant.
- Mutable Question rows and `depth` API/UI vocabulary.
- Current-name joins for ended historical attribution.
- Active-membership-only access as the sole history model.
- Rejoin ending only the replaced membership without closing old-era Private/Together activity.

## Deferred blockers that must remain deferred

This inventory does not resolve account deletion, permanent erasure, retention duration, anonymization, former-participant deletion rights, Asked/historical emergency withdrawal, broader moderation/content governance, notification/reminder behavior beyond state-neutral delivery, or the exact storage shape of a membership era. Implementations must not fill those gaps by assumption.
