# Closer V1 Architecture

## Authority and current state

This document defines the canonical V1 domain boundaries, invariants, authorization model, lifecycle behavior, and storage obligations. It intentionally does not prescribe a table-for-every-concept design. User-visible behavior is controlled by [`PRD.md`](./PRD.md); accepted decisions and their reasoning are recorded in [`adr/`](./adr/); canonical vocabulary is maintained in [`../CONTEXT.md`](../CONTEXT.md).

The Go API and Vite client are the active V1 implementation. [`IMPLEMENTATION-GAPS.md`](./IMPLEMENTATION-GAPS.md) is retained as a historical rewrite record and is not an inventory of current runtime gaps.

> **Shared Open amendment (2026-09-20).** ADR 003 and the PRD Shared Open
> section supersede the creator-owned Private rules and legacy Ask/Skip/Like/
> Decline descriptions in this document. Private Conversations remain era- and
> category-scoped, but both members see deterministic candidates, either may
> select, the first answer commits, one self-initiated provisional and one
> committed unresolved initiation are permitted per member, exactly-one-answer
> retirement is symmetric, and Reveal remains viewer-authorized.

## 1. Runtime architecture

Closer is a Bun workspace with a Go HTTP API and a React/Vite single-page client. The Go API owns authentication, authorization, domain transitions, and PostgreSQL access. The Vite client calls the same-origin `/api/v1` routes; development uses the Vite proxy and production serves the built client behind an API reverse proxy.

| Concern                  | Current choice                    |
| ------------------------ | --------------------------------- |
| Web application          | React with Vite                   |
| API                      | Go HTTP server                    |
| Authentication           | Go-managed session cookies        |
| Database                 | PostgreSQL                        |
| Schema and query tooling | Versioned SQL migrations and SQLC |

V1 does not require microservices, tRPC/oRPC, WebSockets, or a generalized group platform. HTTP handlers are adapters around server/domain behavior; they must not become independent sources of product rules.

Logical modules inside this application are:

- **Authentication:** verifies a server-managed session and resolves its domain Participant.
- **Participant identity:** owns stable Participant identity and current display name.
- **Pair access:** owns Pair slots, memberships, membership boundaries, relationship type, credentials, and termination.
- **Question content:** owns logical Questions, immutable revisions, eligibility, deactivation, withdrawal, and intensity metadata.
- **Together:** owns bounded shared-device Sessions and their shown-question occurrences.
- **Private:** owns era-scoped Conversations, candidates, Rounds, answers, reveal views, reactions, and replies.
- **History:** produces viewer-authorized read-only projections across active and ended memberships.
- **Behavioral events:** records non-authoritative product events without duplicating secret answer content or creating a second lifecycle source of truth.
- **Notifications:** may deliver state-neutral prompts later; delivery never mutates reveal or progression state.

## 2. Identity and authentication

The authenticated principal is not the domain Participant:

```text
participant.id != auth_identity.id
```

A session proves an authentication identity. Every product request must resolve that identity to the current stable Participant on the server. Client-supplied auth identity, Participant, Pair, membership, Conversation, Round, candidate, or Session identifiers are selectors, never proof of authority.

Participant onboarding is independent of Pair creation. A Participant may exist with zero active or historical Pairs. The Participant owns one current, non-unique display name, trimmed to 1–40 characters.

Guest-to-registered linking preserves the same `participant.id` even if the underlying authentication identity changes. The auth identity mapping change must be idempotent and transaction-safe; domain ownership is not copied to a second Participant. This boundary is governed by [ADR 001](./adr/001-domain-participant-identity.md).

## 3. Canonical domain model

### Participant

A stable Closer identity that may hold memberships in zero, one, or many Pairs. Authentication identity may change without changing the Participant.

### Pair

One immutable Partner or Friend relationship with exactly two stable logical slots. A Pair is presented as a Space; there is no separate Space entity.

A Pair may be unclaimed in slot 2 and still be active, usable in Together, and capable of retaining Together history. Pair history and future activity are always Pair-scoped. A later Pair between the same Participants is a different aggregate and inherits nothing.

Pair storage must support a terminal, irreversible termination state. Relationship type cannot be updated in V1.

### Pair Membership

The association between one Participant and one Pair slot for one continuous occupancy period. At most one membership is active per slot, and the same Participant cannot occupy both slots in one Pair.

A membership records its start, its optional end, and the Participant display-name snapshot taken at end. Current-product views use the Participant's live display name while membership remains active; history after membership end uses the frozen snapshot.

Membership identity—not just slot identity—owns authorization. A replacement Participant in a reused slot never inherits the former occupant's authority.

### Intended-person name

A required, pair-local string captured at Pair creation, trimmed to 1–40 characters and not unique. It is contextual copy, not identity, authentication, an alias, or a placeholder Participant.

The sole active member may edit it while slot 2 remains unclaimed; editing does not affect credentials. Initial claim atomically clears it without retaining hidden claimant metadata. If the Pair terminates unclaimed, it remains as read-only contextual Pair information.

### Pair membership era

One continuous configuration of the Pair's two active memberships. It is an internal authorization and history boundary, not a user-facing Space and not necessarily a dedicated database row.

The first two-member era begins at initial claim. Guest replacement ends the current era and begins a new one. Pair termination ends the active configuration without permitting another era in that Pair.

The implementation must persist or derive one stable, authoritative era/configuration identity sufficient to bind Private Conversations and history. It must not use two independent closure timestamps that can disagree. The exact representation—an explicit era row, stable membership-configuration key, or equivalent—is deferred until implementation.

### Initial Invitation

A high-entropy bearer credential bound to an unclaimed second slot. The server stores only its hash and lifecycle metadata. At most one valid initial invitation is usable at a time.

Initial invitation issuance is lazy: Pair creation does not issue it. It is created or reused only after explicit Invite/Connect or entry to Private while slot 2 is unclaimed. Replacement of a still-valid invitation is explicit and atomic.

### Together Session

A bounded use of Together within one Pair membership configuration. It owns one category, one ordered set of shown Question revisions, and Like/Skip/Next state. It stores no verbal answers.

Initial claim, guest replacement, and Pair termination end active Sessions that began before their boundary.

### Private Conversation

A persistent, category-specific sequential Question stack belonging to one Pair membership era. There is at most one Conversation for each `(Pair, membership era, category)` tuple.

Its creator is the Participant whose transaction first creates it and is immutable. The Conversation becomes read-only when its era ends or the Pair terminates. It has no user-triggered Finish, Restart, or generic Private Session lifecycle.

### Private Question Candidate

One persisted, unresolved occurrence of an eligible Question revision offered only to the Conversation creator before a Round exists. The candidate includes a stable occurrence identity, its pinned revision, its selection context/seed, creator-attributed Like state, and one terminal resolution: Asked, Skipped, or invalidated.

Ask and Skip consume the candidate and are mutually exclusive. Like is toggleable only while unresolved. Invalidation due to an era or Pair boundary creates no Round. Emergency withdrawal also invalidates an unresolved candidate.

### Private Round

One numbered Question Asked inside a Conversation. Ask assigns the next stable positive number. Skips create no Round and do not affect numbering. Declined Rounds remain numbered Rounds.

The Round pins the candidate's exact Question revision and has an answer/reveal lifecycle independent of every other Round and Conversation.

### Private Answer

One immutable, trimmed 1–2000 character answer submitted by one Round Participant. There is at most one answer per `(Round, Participant)`. The answer position belongs to the Participant/membership represented in the Round, not to whoever later occupies the slot.

### Reveal View

An idempotent record that one Round Participant explicitly opened a reveal-ready Round. Reveal readiness and reveal viewing are distinct:

- two persisted answers make content reveal-ready;
- each Participant's Reveal View records their own presentation event;
- both Reveal Views are required before creator progression.

There is no global `REVEALED` state and notification delivery never creates a Reveal View.

### Reaction and Reply

Post-reveal content owned by one Round Participant. Each Participant has at most one reaction and one optional reply per Round. Reactions target the other Participant's answer. Replies are trimmed to 1–500 characters. Owners may change/remove these only while the enclosing era and Pair remain mutable.

### Question and Question Revision

A Question is the stable logical identity used for consumption and no-repeat rules. A Question revision is one immutable version of its text, category, Partner/Friend fit, mode fit, intensity, and other revisioned selection metadata. Deactivation and withdrawal are separate lifecycle controls over future or unresolved use.

Candidates, Private Rounds, and Together shown-question occurrences reference the exact revision presented. Historical wording and eligibility never change when a later revision is created.

`intensity` has values `light`, `medium`, and `deep`. It is internal selection metadata distinct from the user-facing Deep category.

## 4. Pair invariants and lifecycle

Pair creation requires an existing Participant, intended-person name, and relationship type. It creates slot-1 membership only. It does not issue an invitation.

The following invariants apply:

- A Participant may belong to multiple Pairs.
- No Participant may occupy both slots of one Pair.
- At most one active membership may occupy a Pair slot.
- At most one active, fully claimed Pair may exist for the same unordered Participant pair, independent of relationship type.
- Multiple unclaimed Pairs are allowed; intended-person names cannot identify or deduplicate a Participant.
- Relationship type is immutable.
- Pair termination is terminal and idempotent.

### Initial claim

Initial claim is distinct from guest replacement. In one transaction it:

1. locks/revalidates the active Pair and invitation;
2. verifies slot 2 is empty and the claimant is not slot 1;
3. rejects if the two Participants already share another active, fully claimed Pair;
4. inserts slot-2 membership;
5. consumes the invitation;
6. clears the intended-person name;
7. begins the first two-member era;
8. ends active pre-claim Together Sessions.

If any invariant rejects the claim, the transaction does not consume the invitation. The claimant receives no pre-claim Together history.

### Guest replacement

Guest rejoin targets a specific active guest membership and requires authority from the other active member. Registered Participants use normal authentication recovery.

Successful replacement atomically:

1. ends the target membership and freezes its display name;
2. invalidates credentials targeting the ended membership;
3. ends the current membership era;
4. makes its Private Conversations and Rounds read-only;
5. invalidates unresolved candidates without creating Rounds;
6. ends active Together Sessions;
7. creates the replacement Participant's new membership in the same slot;
8. begins a new membership era.

The continuing Participant keeps only previously authorized history. The replacement receives no earlier Private or Together content. Conversation creator authority never transfers; a category selected in the new era creates a new Conversation and creator.

### Pair termination

Either active member may initiate termination without consent from the other. One idempotent transaction:

1. records the Pair's terminal state;
2. ends all active memberships and freezes their current display names;
3. ends the active membership configuration;
4. invalidates unresolved candidates;
5. revokes active initial and rejoin credentials;
6. ends active Together Sessions.

Termination does not delete or rewrite existing Private Rounds, answers, Reveal Views, reactions, replies, or Together history. All later Pair-scoped product mutations are rejected. Reads use Former-Pair authorization.

Membership-era, termination, and historical authorization reasoning is recorded in [ADR 005](./adr/005-pair-membership-era-termination-and-history.md).

## 5. Credential model

Initial invitations and rejoin links are separate credential types with distinct authority. Both are opaque, cryptographically strong, revocable, expiring bearer credentials persisted only as hashes. QR codes, copy, and native share are presentations of the same URL, not new credentials.

### Initial invitation rules

- Bound to slot 2 while it is unclaimed.
- Expires after 7 days.
- Single-use and revocable.
- Created lazily; one usable invitation at a time.
- Reused while valid.
- Raw token redisplay depends on local retention by the issuing browser.
- Other devices may read existence and expiry only.
- Explicit `Replace invitation` revokes the valid credential and creates a new one atomically.
- Never authorizes replacement or recovery after claim.

The landing projection for a valid token exposes only the inviter's current display name, immutable relationship type, intended-person contextual copy, and the current claimant's own display name. Redemption requires explicit `Join space`; landing-page reads, navigation away, and UI decline are non-consuming.

### Rejoin rules

- Targets one active guest membership and slot.
- May be issued only by the other active member.
- Cannot target the issuer or a registered Participant.
- Expires after 24 hours.
- Is fresh, single-use, revocable, and not derived from the original invitation.
- Creates a new Participant/membership rather than transferring identity.

Detailed security reasoning is recorded in [ADR 002](./adr/002-invite-and-rejoin-security.md).

## 6. Private Conversation state and progression

Conversation creation serializes on `(Pair, current era, category)`. If two Participants start the same category concurrently, the first commit creates the Conversation and becomes creator; the other request returns that Conversation with non-creator state.

At any point, a Conversation has at most one progression focus:

- an unresolved candidate;
- an Asked Round awaiting answers;
- a reveal-ready Round awaiting one or both Reveal Views;
- a mutually completed or Declined Round from which the creator may request the next candidate;
- exhausted eligible content.

Starting/resuming a category returns the existing unresolved focus. It never creates a second candidate or overlapping next Round.

The creator alone may enter candidate selection. When no candidate already exists, selection deterministically chooses and persists one revision. The non-creator never receives unresolved candidate identity, text, Like state, or eligibility details.

Candidate transitions are:

```text
UNRESOLVED --Ask--> ASKED + numbered Private Round
UNRESOLVED --Skip--> SKIPPED + no Round
UNRESOLVED --era/Pair end or withdrawal--> INVALIDATED + no Round
```

Ask and Skip are idempotent for the candidate occurrence and serialize against each other. A Like mutation is valid only while unresolved; Ask, Skip, or invalidation freezes its final state.

### Asked Round lifecycle

```text
OPEN --first answer--> OPEN
OPEN --second answer--> REVEAL_READY
OPEN --eligible Decline--> DECLINED
REVEAL_READY --one Reveal View--> REVEAL_READY
REVEAL_READY --second Reveal View--> MUTUALLY_COMPLETED
```

Decline is available only to a Participant who has not answered. It is unavailable after both answers exist. Decline and answer submission for the same position serialize; the first commit wins. Decline is terminal, permits no reveal/reaction/reply mutation, and immediately permits creator candidate progression. A lone answer remains private to its author.

The creator may request another candidate only after the current Round is Declined or mutually completed. For a non-declined Round, the server requires both answers and both Reveal Views. Creator status, elapsed time, one Reveal View, notification delivery, or client state cannot bypass the gate.

Private authorization and lifecycle reasoning is recorded in [ADR 003](./adr/003-private-answer-reveal.md).

## 7. Private confidentiality and projections

Before both answers exist, a viewer-aware server projection may return only:

- the viewer's own answer, if present;
- public Question revision content for an Asked Round;
- non-sensitive Round and waiting state.

The other answer must not appear in route payloads, server component props, client caches, logs, behavioral events, hidden UI, or polling responses.

Once both answers exist, an active Round Participant may explicitly record their Reveal View and receive both answers. Reaction/reply mutations require that the actor has viewed Reveal and that the Pair/era remains mutable.

Pair and era boundaries change mutability but do not rewrite the answer state that committed before them:

- For a never-ready Round, each former Participant can read only their own answer.
- If both answers committed before the boundary, both former Participants can read both answers whether or not either had recorded a Reveal View.
- Existing reactions and replies remain readable but immutable.
- A Declined Round exposes a lone answer only to its author.

This former-history visibility rule is deliberately distinct from active progression: both Reveal Views are required to continue an active Conversation, but they are not required to read an already-mutually-answered Round after the era or Pair has ended.

## 8. History authorization

History is a server-derived, viewer-specific projection. It must join activity to the viewer's actual membership interval and, for Private content, the Participant identities authorized in that Conversation/Round. Slot occupancy alone is insufficient.

Active views display live Participant names. Ended-membership history uses membership-end name snapshots. A continuing member may see old-era content they were already authorized to access; a replacement sees nothing created before their membership began.

Former-Pair history is read-only. It includes authorized Together history and Conversation-grouped Private history, including neutral Declined entries. No ended Pair or era can accept an answer, reveal, reaction, reply, candidate, Round, Together, invitation, rejoin, or other product mutation.

The history model must preserve Pair boundaries. A new Pair between the same Participants cannot query or continue the old Pair through identity matching.

## 9. Question identity and selection

Question selection operates on logical identity plus immutable revision:

1. determine revisions eligible for category, relationship type, mode, activation, and withdrawal state;
2. exclude logical Questions consumed within the relevant Conversation or shown within the Together Session;
3. determine the current preferred intensity;
4. choose the first intensity band with eligible content using the defined fallback order;
5. apply a stable Conversation- or Session-scoped deterministic ordering within that band;
6. persist the chosen revision occurrence before returning it.

Selection must be injectable or otherwise deterministic under test. Concurrent selection and retries for one progression point must converge on the same persisted candidate or shown-question occurrence. New eligible revisions added later may become available, but never replace a persisted unresolved candidate.

### Consumption boundaries

- Private consumption is scoped to one Conversation and uses stable logical Question IDs.
- Asked and creator-Skipped Questions are consumed.
- Likes, Declines, answers, Reveal Views, reactions, and replies do not independently alter consumption.
- A Private Conversation never cycles consumed Questions.
- Together consumption is scoped to one Session; every shown logical Question is consumed for that Session.
- A new Conversation in a new era and a new Together Session begin with empty consumption.

### Intensity ramps

Private target intensity is based on mutually completed Rounds:

- 0–1 → Light;
- 2–3 → Medium;
- 4+ → Deep.

Together target intensity is based only on completed `Next` transitions:

- 0–1 → Light;
- 2–3 → Medium;
- 4+ → Deep.

Private Skip/Decline/Like and Together Skip/Like do not advance a ramp. Deep remains preferred after the threshold. Fallback bands are:

- Light target: Light → Medium → Deep;
- Medium target: Medium → Light → Deep;
- Deep target: Deep → Medium → Light.

Exhaustion returns a terminal-for-now result to the UI: `You've reached the end for now.` It does not cycle, close a Private Conversation, create a replacement Conversation, or prevent later continuation if new eligible content is added.

### Deactivation and withdrawal

Ordinary deactivation excludes a revision from future selection but does not invalidate a persisted candidate or rewrite a shown/Asked occurrence. Emergency withdrawal invalidates unresolved candidates. Handling of already-Asked and historical occurrences after withdrawal is deliberately deferred to a separate moderation/content-governance contract.

Question architecture is recorded in [ADR 006](./adr/006-question-identity-revisions-and-selection.md).

## 10. Together lifecycle

Together start requires one active membership and a valid category for the Pair's relationship type. A Session persists its membership-configuration boundary, category, starter, start/end timestamps, selection seed/context, and ordered shown revision occurrences.

Only one shown question is current. Like toggles feedback on that occurrence. Skip marks it skipped and chooses another without advancing intensity. Next marks it advanced, increments the progression signal, and chooses another. Retried start or transition requests must converge without duplicating Sessions or positions.

Together actions are Session-level and intentionally not attributed to the person who tapped on the shared device, although the Session starter may be known. Together never owns Private Answers or Reveal Views.

Initial claim, guest replacement, and Pair termination serialize against Together mutations. The first committing transaction determines whether the mutation is retained before the boundary or rejected after it. Boundary transitions end active Sessions and prevent continuation.

## 11. Server-side authorization matrix

| Operation                      | Required authority and state                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Read active Pair               | Current Participant has an active membership in that Pair                                                                  |
| Read Former-Pair history       | Current Participant has an ended membership and the requested content lies within that membership's authorization boundary |
| Issue/reuse initial invitation | Current Participant is the sole active member; slot 2 is unclaimed; Pair is active                                         |
| Replace initial invitation     | Same as issue, plus explicit replacement intent                                                                            |
| Claim initial invitation       | Valid credential, active Pair, empty slot 2, claimant not slot 1, no duplicate active fully claimed Pair                   |
| Issue rejoin link              | Actor is the other active member; target is an eligible active guest membership                                            |
| Redeem rejoin link             | Valid target-bound credential and unchanged target membership                                                              |
| Start/mutate Together          | Actor has active Pair membership; Session belongs to the current configuration and remains active                          |
| Start/resume Private category  | Both slots active; return/create Conversation in current era                                                               |
| View candidate                 | Actor is immutable Conversation creator and candidate/era is active                                                        |
| Like/Ask/Skip candidate        | Actor is creator; candidate unresolved; Pair and era active                                                                |
| Submit answer                  | Actor is a Round Participant, has not answered or Declined, and Pair/era/Round are mutable                                 |
| Decline Round                  | Actor is a Round Participant who has not answered; fewer than two answers; Round mutable                                   |
| View/record Reveal             | Actor is a Round Participant; both answers exist; active Pair/era for mutation                                             |
| React/reply                    | Actor viewed Reveal; Round reveal-ready; Pair/era mutable; actor owns mutation                                             |
| Progress Conversation          | Actor is creator; current Round Declined or both answers and both Reveal Views exist                                       |
| Terminate Pair                 | Actor has an active membership; confirmation is a UI requirement; operation is idempotent                                  |

Authorization failures should not disclose whether unrelated Pair, membership, credential, Conversation, candidate, Round, answer, or Participant identifiers exist.

## 12. Transaction and concurrency requirements

Correctness depends on serialization at the Pair, membership configuration, Conversation, candidate, or Round boundary as appropriate. A particular lock primitive is not mandated, but these observable outcomes are:

- **Claim versus Pair termination:** first commit wins; a post-termination claim is rejected without consuming a credential.
- **Claim versus Together mutation:** first commit wins; claim ends active pre-claim Sessions and later Session mutation is rejected.
- **Replacement versus Together mutation:** first commit wins; replacement ends old-configuration Sessions and later mutation is rejected.
- **Duplicate active Pair check at claim:** checked transactionally with slot claim so two Participants cannot gain a second active fully claimed Pair through racing claims.
- **Conversation creation race:** one `(Pair, era, category)` Conversation and one immutable creator; losing requests resolve to it.
- **Candidate selection race:** one persisted candidate for the progression point.
- **Ask versus Skip:** exactly one terminal candidate result; retries return the committed result.
- **Decline versus answer:** first commit determines the valid terminal/answer state; impossible combinations are rejected.
- **Answer versus Pair termination:** an answer committed first remains in history; termination committed first causes rejection.
- **Second answer versus termination:** if the answer commits first, the Round is mutually answered and both answers are readable in former history; otherwise it remains never-ready.
- **Pair termination:** atomically applies all terminal effects, is idempotent, and rejects all later Pair-scoped mutations.

Reads need not share mutation serialization, but every read must derive an internally consistent authorized projection from committed state.

## 13. Persistence requirements without table prescription

The storage model must be able to enforce or reconstruct:

- terminal Pair state and immutable relationship type;
- stable two-slot memberships, start/end boundaries, and end-name snapshots;
- stable era/configuration identity for Conversations and Sessions;
- intended-person name clearing or unclaimed-history retention;
- one valid hash-only invitation plus explicit replacement lifecycle;
- credential purpose, expiry, revocation, redemption, and target membership;
- one Conversation per Pair/era/category and immutable creator;
- one unresolved candidate per Conversation progression point with pinned revision and Like/resolution state;
- stable Round numbering and Declined state/actor/time;
- immutable answers and per-Participant Reveal Views;
- reaction/reply ownership and terminal immutability;
- stable logical Question identity and immutable revisions;
- revision-pinned Private/Together occurrences and logical-ID consumption;
- deterministic selection inputs and intensity progression signals;
- authorized Former-Pair and former-era history.

Automatic Conversation closure should either be derived from one authoritative era lifecycle or stored as its direct consequence. A legacy `private_conversation.ended_at` must not be retained as a second independent lifecycle flag that can disagree.

## 14. Polling, PWA, and notifications

V1 does not use WebSockets. Foreground polling may refresh waiting, reveal, and creator-progression state. It must poll only while useful/visible, refresh on foregrounding, stop when state is no longer actionable, and never include unrevealed answer content or creator-only candidate data for a non-creator.

Notification permission must not be requested during onboarding. A later contextual prompt may be offered after answer submission. Notification/reminder delivery is state-neutral: it cannot submit an answer, Decline, mark Reveal viewed, advance a Conversation, or satisfy a timeout. Exact notification/reminder behavior is deferred.

## 15. Testing strategy

The primary correctness seam is the database/domain layer because it combines authorization, state transitions, and transaction ordering. Route tests should verify authentication, validation, no-store/confidential projections, and stable error mapping without duplicating domain tests. UI tests should cover role-specific states and actions, not re-prove database concurrency.

Tests should assert external behavior and invariants rather than lock choices, table names, or incidental query counts. Deterministic selection needs injectable seed/order control so normal tests do not rely on randomness or live content order.

Required domain/integration coverage includes:

- independent Participant onboarding and zero/multiple Pair memberships;
- intended-person validation, edit, atomic claim clearing, and unclaimed termination retention;
- lazy invitation issue/reuse, local raw-token limitation, explicit replacement, and hash-only persistence;
- explicit non-consuming join landing and duplicate-active-Pair rejection;
- claim/termination/Together transaction races;
- replacement era transition, end-name snapshot, Session closure, and no inherited history;
- Conversation creation race and immutable creator authorization;
- persisted candidate stability and creator-only projection;
- Ask/Skip mutual exclusion, idempotency, consumed sets, and Like freeze;
- Decline/answer races and lone-answer confidentiality;
- pre-reveal isolation, independent Reveal Views, and the both-view progression gate;
- no timeout or non-creator progression bypass;
- former-history answer boundaries and immutability;
- Pair termination atomicity, idempotency, credential revocation, and later mutation rejection;
- logical Question revisions and revision-pinned occurrences;
- deactivation versus unresolved-candidate withdrawal;
- deterministic no-repeat selection, exhaustion, later new-content continuation, and both intensity ramps.

## 16. Explicitly deferred architecture

The following remain unresolved and must not be implemented by inference:

- account deletion and permanent erasure;
- retention duration and anonymization;
- deletion rights of former Participants;
- treatment of already-Asked or historical content after emergency Question withdrawal;
- broader moderation and content-governance policy;
- notification/reminder behavior beyond state-neutral delivery;
- exact storage representation of membership era and automatic Conversation closure.

These deferrals do not make Pair termination a deletion mechanism, establish indefinite retention as final policy, or authorize exposing withdrawn historical content. Privacy/erasure and moderation contracts are required before production readiness.
