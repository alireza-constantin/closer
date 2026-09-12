# 09 — Private Ask, Skip, and question Like

Status: ready-for-agent

Blocked by: 08

## Goal

Implement the creator-only candidate decisions that produce the sequential Private question stack without exposing or duplicating candidates.

## Authoritative contract

Closer V1 PRD sections 8 and 10; Closer V1 Architecture sections 6, 9, and 12; ADR 003; ADR 006.

## Current → required behavior

Ask and Skip are idempotent, mutually exclusive outcomes for one candidate. Ask consumes its logical Question, freezes Like, creates the next stable numbered Round, and exposes the pinned revision to both members. Skip consumes without a Round or number, freezes Like, and immediately selects another eligible candidate. Like is creator-only, toggleable while unresolved, occurrence-specific, internal feedback only, and does not affect eligibility, selection, ramp, history, or participant-facing answer/reveal UI. Private selection uses the accepted Light/Medium/Deep soft ramp based only on mutually completed Rounds, exact fallback, deterministic Conversation-scoped order, and no cycling.

## Deliverables

- Creator-authorized Ask, Skip, and Like commands with candidate idempotency and race handling.
- Stable Round numbering and logical consumption records.
- Candidate Like storage/projection restricted to its creator and frozen on resolution.
- Private intensity selector and explicit exhaustion behavior, including later continuation when eligible content is added.
- Removal of superseded direct category-to-Round and direct-next-Round paths.

## Security and privacy invariants

- Only the creator can observe or mutate an unresolved candidate.
- Ask/Skip races commit exactly one outcome.
- Skipped candidates never become Rounds, Pair Home items, answer/reveal state, or user-facing history.

## Acceptance criteria

- Ask creates exactly one next numbered Round; retrying it has no duplicate effect.
- Skip creates no Round, does not increment numbering, and never reoffers its logical Question in that Conversation.
- Like is invisible to the non-creator and has no selection or progression effect.
- No eligible logical Question produces the exact exhaustion message without cycling; later eligible content may continue the same Conversation.
- The ramp targets Light for 0–1, Medium for 2–3, and Deep after 4 mutually completed Rounds with the accepted fallback order.

## Tests

Cover role checks, retries/races, frozen Like, logical consumption, numbers, deterministic ramp/fallback, exhaustion, and removal of direct-round routes.

## Manual verification

Toggle Like on a candidate, Ask it, retry the action, then Skip the next candidate and verify only the creator saw both candidates and numbering did not skip.

## Non-goals

Do not submit answers, Decline, reveal, react, reply, or allow any progression before Ticket 10's gates.
