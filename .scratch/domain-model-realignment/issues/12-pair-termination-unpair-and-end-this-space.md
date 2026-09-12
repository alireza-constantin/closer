# 12 — Pair termination: Unpair and End this space

Status: ready-for-agent

Blocked by: 05, 07, 10, 11

## Goal

Implement the irreversible Pair-terminal transition and its confirmation UX while retaining authorized read-only Former-Pair history.

## Authoritative contract

Closer V1 PRD section 13; Closer V1 Architecture sections 4, 8, and 12; ADR 005; `CONTEXT.md` definition of Pair termination.

## Current → required behavior

Either active member may explicitly confirm a unilateral irreversible termination. Use `End this space` while unclaimed and `Unpair` when fully claimed. One idempotent transaction terminally ends the Pair, active memberships, usable initial/rejoin credentials, active Together Sessions, and unresolved candidates; freezes membership-end names; serializes with slot claims and all Pair-scoped mutations. Existing content remains but becomes read-only Former-Pair history. There is no restore, undo, consent wait, reconnection of old content, or data-erasure implication.

## Deliverables

- Terminal Pair state and transactional idempotent command with a defined lock/order boundary.
- Confirmation presentation explaining read-only history, stopped conversations/sessions/invitations, and new-Pair reconnect behavior.
- Credential revocation, Session closure, membership end snapshots, candidate invalidation, and later mutation rejection.
- Claimed/unclaimed wording and Former-Pair read-only routing/listing integration.

## Security and privacy invariants

- First committed terminal or Pair-scoped mutation transaction defines the outcome; later mutation fails.
- Termination never physically deletes Pair/history content or implies account/privacy erasure.
- A future Pair between the same people is independent and cannot continue old content.

## Acceptance criteria

- Either active member can confirm termination; the other need not acknowledge it.
- Repeating the command is safe and leaves one terminal result.
- Active invitation/rejoin credentials stop working, Together ends, and all later Pair mutations are rejected.
- Existing authorized history remains read-only, including retained intended-person context for an unclaimed terminated Pair.
- New Pair creation after termination does not inherit conversations or history.

## Tests

Cover claimed and unclaimed termination, confirmation contract, idempotency, concurrency with claim/answer/candidate/Session transitions, credential revocation, history, and new-Pair separation.

## Manual verification

Terminate a claimed and an unclaimed Space during active work, try each former action and credential, then create a new Pair between the same people.

## Non-goals

Do not implement undo, restore, consent workflow, permanent deletion, account deletion, retention/anonymization policy, or notifications as a termination prerequisite.
