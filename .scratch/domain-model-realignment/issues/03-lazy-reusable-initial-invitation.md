# 03 — Lazy reusable initial invitation

Status: ready-for-agent

Blocked by: 02

## Goal

Securely issue, redisplay, inspect, replace, and redeem-status an Initial invitation only when an unclaimed Pair explicitly needs connection.

## Authoritative contract

Closer V1 PRD section 6; Closer V1 Architecture section 5; ADR 002; `CONTEXT.md` definition of Initial invitation.

## Current → required behavior

Creation must not mint a credential. Explicit Invite/Connect and attempting Private with an unclaimed second slot may create one; a valid credential is reused. Store only a hash server-side. The issuing browser may redisplay a locally retained raw credential, while other devices see only validity and expiry. Replacing is explicit and atomically revokes the old credential before issuing a new one; raw-token loss never silently rotates it.

## Deliverables

- One-active-invitation lifecycle, expiry, hash-only server storage, and local raw-token retention boundary.
- Explicit Invite/Connect and Private-entry issuance paths that share reuse behavior.
- Status/expiry projection safe for another creator device.
- Explicit Replace invitation command with a warning and atomic revoke-then-create behavior.
- Read-only invitation landing context sufficient for Ticket 04 without redeeming a credential.

## Security and privacy invariants

- Raw bearer credentials never persist server-side and cannot be recovered by another device.
- Opening, leaving, and declining the join UI never consumes or revokes an invitation.
- A still-valid invitation never rotates silently.

## Acceptance criteria

- Repeated explicit connection actions reuse a valid invitation.
- Only the originating browser can redisplay a retained raw link; another device sees status and expiry only.
- Replace makes the previous credential unusable and supplies exactly one fresh credential.
- Unclaimed Private entry creates or reuses an invitation without claiming the slot.

## Tests

Add credential hashing, reuse, expiry, replacement atomicity, cross-device projection, and non-consuming landing coverage.

## Manual verification

Open Invite from two creator devices, replace from one, and confirm only the replacement link can reach the contextual join landing.

## Non-goals

Do not claim the Pair, create a fake Participant, implement rejoin replacement, or expose a raw credential to another browser.
