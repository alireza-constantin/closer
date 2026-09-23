# ADR 003: Shared Open Private Conversations with explicit reveal

**Status:** Accepted — amended 2026-09-20

## 2026-09-20 Creator-owned candidate-control amendment

This amendment supersedes only the **candidate-stage authority** portions of
the 2026-09-19 Shared Open amendment below. The older amendment is retained as
historical context; its shared Private Round, answer, Reveal, Decline,
retirement, membership-era, and history rules remain in force unless this
amendment explicitly replaces them.

Each Private Conversation has an immutable creator. While an unresolved
candidate exists, that creator alone may receive its wording and metadata,
select it, Ask, Skip, Like, and begin the next candidate when progression is
allowed. Candidate selection remains deterministic and persisted, but it is
creator-owned rather than shared.

The non-creator receives only a waiting projection while a candidate is
unresolved. The server must not serialize candidate wording, question or
revision identity, or candidate metadata to that participant through routes,
Server Component props, client state, caches, polling, logs, or events.

Ask atomically creates a Private Round with the exact pinned Revision. From
that point, the established shared Private Round rules apply: both
participants' answering, answer confidentiality, Reveal Views, Decline,
retirement, and authorized history remain unchanged. This amendment changes no
Round-stage authority or behavior.

The earlier statements that either participant may select an unresolved
candidate, that the candidate is visible to both, and that the UI never has a
waiting-for-the-creator state are superseded.

## Historical: 2026-09-19 Shared Open amendment

> This amendment supersedes every creator-only, Ask/Skip/Like, Decline, and
> creator-progression rule below. The retained historical discussion documents
> why the old storage existed; it is not an active product rule.

Private Conversations remain one persistent `(Pair, membership era, category)`
resource. `created_by_participant_id` is historical creation metadata only; it
never grants continuing social or progression authority.

Each free category exposes the same persisted deterministic candidate to both
active members. Either may select it. Selection atomically creates one shared
provisional `private_round`, pinning the revision and initiator. It is visible
to both immediately and both can answer concurrently. It has no notification,
consumption, durable-history, category-commitment, or initiator-slot effect
until its first answer atomically writes `committed_at`.

An unanswered provisional records a 30-minute cleanup-eligibility time, but a
clock never deletes a question from an open viewer. Submission remains valid
after that time and commits under the Pair lock. Until an explicit
viewer-safe abandonment operation exists, later category entry resumes the
same provisional rather than removing it beneath a participant who may be
reading or typing.

The same Pair lock serializes category selection, first-answer commitment,
retirement, Pair lifecycle, and cross-category races. A participant can have
only one active self-initiated provisional; another generative selection
resumes that provisional instead of creating a second one. At commitment it checks
that the initiator has no other committed unresolved open round in that Pair.
Participation in another initiator's round does not count. A category has only
one unresolved open round, and the resulting maximum is two committed
unresolved rounds per Pair, one per participant.

Exactly one answer permits either participant to retire the round. The answer
is permanently sealed; the Question remains consumed; the initiator slot and
category become available. With two answers retirement is rejected. Both
answers remain absent from every projection until that viewer explicitly opens
Reveal. Reveal Views remain viewer-local authorization records. A fully
revealed round can lead to the same category's normal candidate selection,
another category, or Pair Home; there is no automatic advance.

The UI never attributes a selection to either participant and never presents
chooser, turn, quota, pending, debt, or waiting-for-a-person language. Private
entry routes only receptive work (an answerable open round or reveal-ready
round); otherwise it opens the category hub. The hub presents calm category
state, never counts, badges, timestamps, or obligations. The existing
`private.changed` SSE event refreshes active clients after selection, answer,
retirement, and reveal. Background notification begins with first answer, not
candidate selection, using the existing notification seam when configured.

## Context

Private mode depends on two forms of trust. First, neither Participant's answer may be exposed to the other before both answers exist. Second, a category must remain one understandable sequential Question stack across navigation, retries, and multiple devices instead of allowing overlapping candidate, answer, and reveal states.

Closer also needs a real pre-round choice for Ask, Skip, and content feedback; a clear distinction between skipping an unasked candidate and declining an already-Asked Round; and a membership boundary that prevents a replacement Participant from inheriting an earlier Conversation.

## Decision

Private is modeled as persistent, creator-owned Conversations within one Pair membership era. There is no generic Private Session.

### Conversation identity and creator

There is at most one Private Conversation for a `(Pair, membership era, category)` tuple. The first Participant whose category-start transaction creates it becomes its immutable creator. Concurrent starts converge on the same Conversation and creator.

Creator authority does not alternate by Round, transfer, become shared, permit delegation, expire, or allow inactivity takeover in V1. Different categories in the same Pair and era may have different creators.

Only the creator may view and control unresolved pre-round candidates or begin the next candidate after progression is allowed. The non-creator may answer Asked Rounds, Reveal, react, reply, read authorized history, and navigate away, but never receives unresolved candidate content.

A Conversation persists across navigation and has no manual Finish or Restart. It becomes read-only when its membership era ends or the Pair terminates. Replacement never inherits or resumes the old Conversation; a category in the new era creates a new Conversation, creator, sequence starting at Round 1, and empty consumed-question set.

### Persisted question candidate

Before a Round exists, the server deterministically selects and persists one eligible Question candidate occurrence for the creator. It pins an immutable Question revision and remains stable across refreshes, retries, navigation, concurrent requests, and creator devices.

Candidate actions are:

- **Ask:** creator-only; consumes the candidate and atomically creates the next numbered Round using the same pinned revision.
- **Skip:** creator-only; consumes the candidate, creates no Round, does not increment numbering, and permits immediate selection of another candidate.
- **Like:** creator-only, occurrence-specific feedback; toggleable while unresolved; does not consume, create a Round, alter eligibility/numbering, or affect reveal/progression.

Ask and Skip are idempotent and mutually exclusive for one candidate. Their race has exactly one committed terminal result. Ask/Skip preserves the candidate's final Like state as immutable. Pair termination, era replacement, or emergency withdrawal may invalidate an unresolved candidate without creating a Round. Its Like may remain internal content-quality feedback but the candidate is not user-visible history or future-Conversation consumption.

The consumed-question set is scoped to one Conversation and uses stable logical Question identity. It contains Asked and creator-Skipped Questions. Asked Questions stay consumed if their Round is later Declined. Likes, answers, reveal views, reactions, and replies do not independently affect consumption. Consumed Questions never repeat within the Conversation.

### Round, answer, and Decline lifecycle

Ask assigns the next stable positive Round number. A Declined Round remains in numbering and in the count of Questions Asked; a Skip never receives a number.

Each Participant may submit at most one immutable answer for their position. Before both answers exist, the server may return the viewer's own answer and non-sensitive state only. It must not serialize the other answer into routes, server-component props, client state, caches, logs, polling results, or behavioral events.

Either Participant may Decline an already-Asked Round only before submitting their own answer:

- with zero answers, either Participant may Decline;
- with one answer, only the unanswered Participant may Decline;
- with two answers, Decline is unavailable.

Decline and answer submission serialize, and the first commit determines the result. Decline is terminal: no Reveal, reaction, or reply follows. A lone submitted answer remains visible only to its author. The Round appears in history as neutral `Question passed` without naming the actor, although actor and timestamp may be retained internally. The creator may proceed immediately to another candidate.

### Mutual reveal and progression

For a non-declined Round, both persisted answers make the Round reveal-ready. Each Participant explicitly records their own Reveal View; there is no global `REVEALED` acknowledgement. One view never writes the other's view.

The active Conversation's next-candidate gate is stricter than answer confidentiality:

```text
both answers persisted
AND creator Reveal View persisted
AND non-creator Reveal View persisted
```

Only after all three conditions hold may the creator begin another candidate. The reveals need not be simultaneous. If the creator revealed first, they wait while the other Participant continues to see Reveal ready. Foreground polling may refresh eligibility when the second view commits.

When the second Reveal View is committed, the Round's persisted progression status
becomes `completed` in that same transaction. This status releases the
Pair-wide open-Round guard; it is valid only alongside both answers and both
Reveal Views, and is not a substitute for any of those facts or a global Reveal
acknowledgement. The creator's later progression command persists its request
ID and result atomically with candidate selection or exhaustion.

There is no timeout, reminder completion, override, bypass, creator privilege, or non-creator progression path. Other category Conversations remain usable while a Conversation waits.

After a Participant records a Reveal View, the authorized reveal projection returns both answers. Reactions and optional replies are post-reveal mutations owned by their Participant. Each Participant may have at most one reaction and one reply per Round; the reaction is shown on the other Participant's answer.

### Selection and exhaustion

Candidate selection first filters eligible immutable revisions, excludes the Conversation's consumed logical Questions, applies the current soft intensity preference and fallback order, then uses deterministic Conversation-scoped ordering within the selected band. The chosen candidate is persisted before being returned. Likes, answer content, reactions, replies, and behavioral personalization do not influence V1 selection.

The preferred intensity is Light for 0–1 mutually completed Rounds, Medium for 2–3, and Deep for 4 or more. Only Rounds with both answers and both Reveal Views advance the count. Skip, Decline, Ask alone, partial answers/reveals, Like, reactions, and replies do not.

When every eligible logical Question is consumed, the Conversation remains open and returns `You've reached the end for now.` It does not cycle, restart, or create a replacement Conversation. New eligible content added later may permit continuation without replacing any already-persisted candidate.

### Era and Pair boundaries

Era replacement and Pair termination invalidate unresolved candidates, close the Conversation to mutation, and preserve existing Rounds without rewriting them.

After the boundary:

- a never-ready Round exposes each submitted answer only to its author;
- a Round with both answers committed before the boundary exposes both answers to both former Participants, regardless of whether either had opened Reveal;
- a Declined Round retains author-only access to any lone answer;
- existing reactions and replies remain readable and immutable.

These read-only history rules do not relax the active Conversation's both-Reveal progression gate.

## Consequences

- Private requires a server-backed candidate model and creator-aware projections.
- Conversation uniqueness and Round progression are era-scoped rather than Pair-global.
- Candidate selection, Ask/Skip, Decline/answer, and next-candidate progression need transaction-safe commands.
- Private reads remain viewer-aware at every active and historical boundary.
- Pair Home and category entry surface one Conversation-relative state without becoming chat or an inbox.
- A membership-era representation must close Conversations automatically without introducing an independent lifecycle timestamp that can disagree.
- Integration tests must cover creator authorization, candidate stability, no-repeat consumption, Decline, confidentiality, both-Reveal progression, exhaustion, and former-history visibility.

## Alternatives considered

- **Create a Round immediately on category selection:** rejected because the creator needs a private, retry-stable Ask/Skip/Like decision before exposing a Question to both Participants.
- **Let either Participant choose the next Question:** rejected because it breaks immutable creator ownership and can create competing progression.
- **Allow the creator to continue after their own Reveal View:** rejected because it permits overlapping Q1-reveal and Q2-answer states in one sequential Conversation.
- **Add a reveal timeout or creator override:** rejected because time and notification delivery are not proof that the other Participant viewed the answers.
- **Send both answers and hide one in the UI:** rejected because concealment is not authorization.
- **Use one Pair-global current Private Round:** rejected because different category Conversations may remain independently active.
- **Cycle after exhaustion:** rejected because it violates Conversation-scoped no-repeat semantics.
- **Finish and restart Conversations manually:** rejected because V1 Conversations persist and close only at membership-era or Pair boundaries.
