# 02 — Create and navigate Partner/Friend Spaces

Status: ready-for-agent

Blocked by: 01

## Goal

Let an onboarded Participant create and reopen multiple independent Partner or Friend Spaces without replacing an existing Pair.

## Authoritative contract

Closer V1 PRD sections 2–5; Closer V1 Architecture sections 3–4; `CONTEXT.md` definitions of Pair, intended person name, Space, Together, and relationship type.

## Current → required behavior

Create a Pair from an existing Participant, a required trimmed intended-person name, and immutable Partner/Friend relationship type. The unclaimed Pair is real immediately: Together works, but no initial invitation is issued automatically. The root must list and open existing claimed and unclaimed Spaces, fast-path exactly one active Space, and offer explicit `Add someone` / `Create another space` without workspace-management complexity.

## Deliverables

- Pair and active first-slot membership creation separated from Participant onboarding.
- Intended-person-name validation, unclaimed-slot editing, and truthful display in Space navigation.
- Immutable relationship type and no self-occupation of both Pair slots.
- Root and Pair routing for zero, one, and multiple active Spaces; claimed and unclaimed Spaces remain reopenable.
- Immediate Together entry for the sole active member.

## Security and privacy invariants

- The intended-person name is pair-local contextual copy, never a Participant, identity, authentication claim, or deduplication key.
- A Participant may hold memberships in many independent Pairs.
- Creating another Space never ends, replaces, or merges an existing Pair.

## Acceptance criteria

- An existing Participant can create Partner and Friend Pairs with valid intended-person names and then reopen each Space.
- The root shows a lightweight `Your spaces` list when two or more active Pairs exist and does not arbitrarily select one.
- A single active Pair fast-paths to its Pair Home; zero Pairs offers creation.
- The sole member can edit the intended-person name while unclaimed and use Together immediately.
- Pair creation produces no initial invitation.

## Tests

Cover validation, multiple-Pair navigation, relationship immutability, unclaimed reopening, and Together availability without a second member.

## Manual verification

Create three Spaces with mixed relationship types, switch among their Pair Homes, reopen an unclaimed Space, and create another without changing the first three.

## Non-goals

Do not implement claiming, invitation issuance, Private access, guest replacement, termination, or Slack-style workspace administration.
