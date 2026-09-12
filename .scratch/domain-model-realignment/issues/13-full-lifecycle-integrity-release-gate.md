# 13 — Full lifecycle integrity release gate

Status: ready-for-agent

Blocked by: 12

## Goal

Validate the completed Pair, membership-era, Question, Together, Private, history, and termination lifecycle as one coherent, production-candidate contract.

## Authoritative contract

The complete Closer V1 PRD; Closer V1 Architecture testing and deferred-architecture sections; ADRs 002, 003, 005, and 006; the implementation-gap inventory.

## Current → required behavior

This is an integration and release-readiness ticket, not a place to introduce deferred product policy. Prove the end-to-end system enforces the accepted lifecycle across transactions, server authorization, routes, client projections, migrations, and historical read boundaries. Resolve discovered implementation defects within their owning behavior only; surface any new policy question rather than deciding it implicitly.

## Deliverables

- An end-to-end lifecycle matrix covering onboarding through Former-Pair history and a separately created future Pair.
- Cross-feature authorization and concurrency test coverage for every critical boundary.
- Migration/backfill verification from the repository's current data model to the final direct Question-revision and Pair lifecycle model.
- Route/UI verification that all authoritative states have truthful, non-mutating presentation and no legacy paths remain reachable.
- Release-readiness report of passed checks, known limitations, and explicitly deferred privacy/moderation contracts.

## Security and privacy invariants

- Server authorization, not hidden UI, protects candidate and answer confidentiality.
- Transaction order determines termination/claim/mutation outcomes consistently.
- No compatibility, history, or migration path restores credentials, transfers creator authority, or exposes former-era content to a replacement.

## Acceptance criteria

- Full lifecycle tests cover zero-Pair onboarding; multiple Space navigation; invitation/replacement; era transitions; Question revisions/intensity; Together; Private Ask/Skip/Like/Decline/reveal; history; and termination.
- Critical concurrency cases produce exactly one committed authoritative outcome with safe retries.
- Legacy mutable Question, `depth`, direct Private-round, silently rotating invite, and obsolete lifecycle routes are absent or reject safely.
- Build, type, formatting, focused/integration, and relevant browser/manual checks are reported with exact results.
- Deferred account deletion, permanent erasure, retention, anonymization, and historical withdrawal policy are explicitly recorded as unresolved rather than assumed complete.

## Tests

Run and extend focused domain, integration, route/component, migration, and end-to-end suites; include negative authorization and race assertions for every cross-boundary operation.

## Manual verification

Execute a two-device checklist from new Participant through multiple Spaces, claim, replacement, Together, Private, history, termination, and a fresh Pair; compare each surface to the PRD.

## Non-goals

Do not add account deletion, permanent erasure, retention, anonymization, notification policy, historical withdrawal moderation, restore/undo, or a new product feature merely to make this gate pass.
