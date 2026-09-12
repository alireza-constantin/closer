# 07 — Together adaptive, revision-pinned flow

Status: ready-for-agent

Blocked by: 04, 05, 06

## Goal

Make Together a membership-bound bounded Session with revision-pinned, logical-no-repeat, deterministic adaptive question selection.

## Authoritative contract

Closer V1 PRD section 5; Closer V1 Architecture sections 9–10 and 12; ADR 005; ADR 006.

## Current → required behavior

Together requires one active member, stores no verbal answers, and ends on explicit end, initial claim, guest replacement, or later Pair termination. A Session pins its starting membership configuration. Each shown Question pins a revision and never repeats its logical Question inside that Session. `Next` is the only ramp advance; `Skip` consumes without advancing and `Like` only records feedback. The target intensity is Light for transitions 0–1, Medium for 2–3, and Deep from 4 onward, with accepted fallback ordering and deterministic Session-scoped ordering. Exhaustion says `You've reached the end for now.` without cycling.

## Deliverables

- Era/configuration-bound Together Session and revision-pinned shown-question records.
- Deterministic Session-scoped selector with logical no-repeat, mode/category/relationship eligibility, intensity targets, and fallback.
- Correct Next, Skip, Like, explicit end, exhaustion, and idempotency behavior.
- Boundary behavior for initial claim and guest replacement, including no activity access for the incoming member.

## Security and privacy invariants

- Together never persists typed answers.
- A Session cannot continue across a membership boundary.
- UI behavior consumes server-authorized projections and does not determine boundary authority.

## Acceptance criteria

- A sole member may start Together in an unclaimed Space.
- Next produces the two-light/two-medium/deep-preferred ramp; Skip and Like do not advance it.
- A logical Question never repeats, occurrences retain the exact revision, and exhaustion does not cycle.
- Initial claim and guest replacement end an active pre-boundary Session; the incoming participant sees none of earlier activity.

## Tests

Cover ramps and fallback, deterministic ordering, revision pinning, logical no-repeat, Session idempotency, exhaustion, and membership-boundary races.

## Manual verification

Run a Together Session through Next, Skip, Like, and exhaustion; then repeat while a claim or replacement occurs during the Session.

## Non-goals

Do not build Private candidate or answer flows, Former-Pair history, or Pair termination UI.
