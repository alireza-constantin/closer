# 08 — Era-scoped Private Conversations and creator-owned candidates

Status: ready-for-agent

Blocked by: 05, 06

## Goal

Establish persistent Private Conversations per Pair, membership era, and category, with immutable creator ownership and exactly one server-backed unresolved candidate.

## Authoritative contract

Closer V1 PRD sections 7–8 and 10; Closer V1 Architecture sections 3, 6, 9, and 12; ADR 003; ADR 005; ADR 006.

## Current → required behavior

Private is not a generic session and cannot begin until both slots are active. The first successful category start creates the era-scoped Conversation and immutable creator; concurrent starts serialize and retain the winner. Different categories may have different creators. With no current round, persist one eligible candidate, pin its revision and deterministic selection context, and expose it only to the creator. It survives navigation, refreshes, retries, and multiple creator devices until resolution or its era ends. The non-creator sees the required waiting state.

## Deliverables

- Era-scoped Conversation identity, unique category start, immutable creator, and one authoritative closure source derived from era lifecycle or a consistent equivalent.
- Candidate persistence with pinned revision, stable deterministic ordering context, state, and confidential creator-only projection.
- Category start/resume projections for creator, non-creator, no eligible question, and current-round states.
- Automatic old-era read-only closure and candidate invalidation hooks.

## Security and privacy invariants

- Non-creators never receive unresolved candidate content in server responses or client state.
- Creator authority neither transfers nor times out.
- A new era creates a new Conversation with fresh numbering, consumption, intensity progress, and creator.

## Acceptance criteria

- The first serialized starter becomes creator and concurrent category starts produce one Conversation.
- Candidates persist identically across creator devices and refreshes; no competing selection occurs.
- The non-creator sees `Waiting for <creator> to choose a question.` before an Ask.
- Era replacement closes the former Conversation and invalidates its unresolved candidate without making a Round.

## Tests

Cover start races, creator authorization, candidate confidentiality, persistence/retry, deterministic selection context, era closure, and cross-era isolation.

## Manual verification

Open the same category from both devices at once, refresh the creator device, and verify one creator and one stable candidate while the other device sees only waiting copy.

## Non-goals

Do not Ask/Skip/Like, create new Rounds, implement Decline/Reveal, or permit creator takeover.
