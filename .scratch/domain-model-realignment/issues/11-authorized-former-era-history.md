# 11 — Authorized read-only former-era history

Status: ready-for-agent

Blocked by: 05, 07, 10

## Goal

Provide correct read-only history projections across ended membership eras without granting a replacement participant content from before their membership.

## Authoritative contract

Closer V1 PRD section 14; Closer V1 Architecture sections 7–8; ADR 005; `CONTEXT.md` definitions of membership-end display name and Former-Pair history.

## Current → required behavior

History follows authorization, not current active membership alone. When a guest is replaced, the continuing Participant retains only content already authorized; the replacement receives none of the prior era's Private content or Together activity. Historical attribution uses membership-end display-name snapshots. Private visibility preserves its established boundary: in never-ready former rounds, each former participant sees only their own submitted answer; when both answers persisted before the boundary, both former participants may read both answers regardless of prior Reveal UI opening. Existing reactions/replies remain immutable and readable when authorized.

## Deliverables

- Read-only former-era history projection and navigation for the continuing/former participant without mutation controls.
- Membership-end display-name attribution that does not follow later display-name edits.
- Together, Private Round, answer, reaction, reply, and candidate-boundary visibility rules encoded as server-authorized projections.
- Replacement isolation checks that exclude all pre-membership data.

## Security and privacy invariants

- Former history never uses a replacement membership to widen an old authorization window.
- Never-ready answers remain author-only forever under the stated contract.
- No read projection permits a mutation in ended content.

## Acceptance criteria

- A replacement member receives no pre-replacement Private or Together content.
- A continuing participant sees only material they were previously authorized to see.
- Former participants see both answers of a round whose two answers were persisted before the boundary, irrespective of reveal-view timing.
- History attributes ended memberships with frozen names after later profile edits.
- All former-era actions are read-only.

## Tests

Add authorization matrix tests for answer states, reveal states, replacement/continuing participant roles, frozen names, reactions/replies, and mutation rejection.

## Manual verification

Replace one participant after testing an unanswered round and a two-answer unviewed round; inspect each identity's history independently.

## Non-goals

Do not terminate the Pair, define account deletion/erasure, grant withdrawal policy for Asked history, or show former-era content to a replacement.
