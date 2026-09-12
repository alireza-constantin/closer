# 04 — Initial claim and first membership era

Status: ready-for-agent

Blocked by: 03

## Goal

Turn a valid Initial invitation into an explicit, transaction-safe first two-member Pair configuration with the correct initial-history boundary.

## Authoritative contract

Closer V1 PRD sections 3 and 6; Closer V1 Architecture sections 4–5 and 12; ADR 002; ADR 005.

## Current → required behavior

The join landing must show the inviter's current display name, immutable relationship type, intended-person contextual copy, and the claimant's actual Participant display name. Existing people retain their name; new people complete Participant onboarding separately. Only explicit `Join space` redeems the credential. Successful claim fills the existing second slot, atomically clears the intended-person name, begins the first two-member era, consumes the invitation, and ends active pre-claim Together Sessions. Rejection leaves the invitation usable.

## Deliverables

- Contextual join flow and authenticated claimant resolution.
- Atomic claim command, second-slot membership activation, intended-name clear, and invitation consumption.
- Stable first membership-era/configuration representation selected as the smallest correct storage model.
- Transactional self-slot and unordered active-fully-claimed-Pair rejection.
- Pre-claim Together closure and no pre-boundary activity exposure to the claimant.

## Security and privacy invariants

- A bearer link is not identity; claim always binds the authenticated Participant who explicitly joins.
- A Participant cannot occupy both slots.
- At most one active fully claimed Pair exists for one unordered participant pair, across relationship types.
- A failed claim does not consume a usable invitation.

## Acceptance criteria

- Browse/leave/decline join does not change invitation state; Join does.
- Successful claim creates the first two-member era and clears the intended-person name with no retained claimant alias.
- Duplicate-Pair and self-slot claims fail transactionally with the invitation still usable.
- A claimant sees no Together activity from before claim, and any active pre-claim session is ended.

## Tests

Cover join context, explicit redemption, duplicate races, self-claim, intended-name clearing, era creation, and Together boundary closure.

## Manual verification

Start Together before invite redemption, open and leave the join page, then explicitly join from another Participant and confirm the original session no longer continues.

## Non-goals

Do not implement guest replacement, Private Conversations, Former-Pair history, or Pair termination.
