# 05 — Guest replacement and new membership era

Status: ready-for-agent

Blocked by: 04

## Goal

Replace an eligible lost guest through a fresh rejoin credential while closing the former membership era and isolating all earlier private content.

## Authoritative contract

Closer V1 PRD section 12; Closer V1 Architecture sections 4, 6, 8, 10, and 12; ADR 002; ADR 005.

## Current → required behavior

Guest rejoin is not initial invitation redemption and never transfers identity or history. A successful replacement ends the outgoing membership and era, freezes its current display name, closes former-era Private Conversations, invalidates unresolved candidates, leaves unresolved rounds under their established confidentiality boundary, ends active Together Sessions, and creates a new membership era. New-category Private work begins a new Conversation later; creator authority never transfers.

## Deliverables

- Distinct rejoin-credential issue/redeem lifecycle with validity and revocation behavior.
- Atomic membership replacement, membership-end display-name snapshot, era boundary, and replacement membership creation.
- Boundary hooks that close active Together Sessions and invalidate unresolved Private candidates without making a Round.
- Authorization projections that prevent the replacement Participant from receiving pre-membership Together or Private content.

## Security and privacy invariants

- The replacement is a new Participant membership, not a renamed or resumed former member.
- A continuing Participant retains only content already authorized to them.
- Former-era Private answers must never cross into the new era.

## Acceptance criteria

- Rejoin replacement atomically creates a new era and freezes the departing member's historical attribution.
- Active Together ends at replacement and cannot be continued by the new participant.
- Unresolved candidates become invalid without a Round; former-era Conversations become read-only.
- The replacement sees no pre-replacement Private or Together activity and receives no creator authority.

## Tests

Add transaction/race, membership snapshot, Session closure, candidate invalidation, and cross-era authorization tests.

## Manual verification

Replace a guest while Together and Private are both active; confirm the replacement enters a new Space state with no former private content.

## Non-goals

Do not expose Former-Pair history UI, terminate the Pair, or transfer a prior Conversation creator role.
