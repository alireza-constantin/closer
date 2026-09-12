# 01 — Participant-first onboarding

Status: ready-for-agent

Blocked by: none

## Goal

Make Participant creation an independent, resumable entry into Closer so a person can exist with zero Pairs and create a Space later.

## Authoritative contract

Closer V1 PRD sections 2–4; Closer V1 Architecture sections 2–4; `CONTEXT.md` definitions of Participant, Pair, Space, and active membership.

## Current → required behavior

The current creation path conflates a person's display name with Pair creation. Replace that with an onboarding flow that creates or restores the authenticated Participant first. A Participant display name is trimmed, non-unique, and 1–40 characters. Completing onboarding must permit a zero-Space state and offer creation as an optional next action; it must not create a Pair, intended-person label, membership, or invitation.

## Deliverables

- Participant persistence and authenticated identity linkage with exactly one Participant per identity.
- An onboarding route and presentation that support a first-time Participant and an already-onboarded Participant without duplicate creation.
- Root-state behavior for zero active Spaces, including navigation into later Space creation.
- Server validation and idempotent handling for duplicate/parallel onboarding submissions.

## Security and privacy invariants

- Authentication identity and Participant remain distinct domain concepts.
- Display names are not authentication, uniqueness, or Pair-claim evidence.
- No request creates a Pair as an incidental onboarding side effect.

## Acceptance criteria

- A newly authenticated person can create a Participant, leave with no Space, return, and still be recognized as that Participant.
- A person who already has a Participant cannot create a second one through refresh or concurrent submission.
- Invalid or blank-after-trim display names are rejected; 1–40-character non-unique names are accepted.
- The zero-Space root experience clearly offers, but does not force, Space creation.

## Tests

Add focused domain/integration coverage for identity linkage, validation, idempotency, and concurrent creation; add route/component coverage for the zero-Space flow.

## Manual verification

Sign in as a new person, complete onboarding, leave without creating a Space, reload, and confirm the later create-space action remains available.

## Non-goals

Do not create Pairs, invitations, Together Sessions, Private Conversations, guest replacement, or termination behavior.
