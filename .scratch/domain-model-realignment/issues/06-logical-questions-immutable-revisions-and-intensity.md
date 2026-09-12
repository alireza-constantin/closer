# 06 — Migrate to logical Questions, immutable revisions, and intensity

Status: ready-for-agent

Blocked by: none

## Goal

Directly replace the mutable Question model with stable logical Questions and immutable Question revisions, using internal `intensity` instead of `depth`.

## Authoritative contract

Closer V1 PRD sections 10–11; Closer V1 Architecture sections 3 and 9; ADR 006; `CONTEXT.md` definitions of Question, Question revision, Question intensity, deactivation, and withdrawal.

## Current → required behavior

There is no production compatibility requirement. Migrate schema, data, callers, and tests directly to `Question → QuestionRevision`; remove obsolete mutable-question and `depth` paths as part of this ticket. Each visible occurrence must pin its revision, while no-repeat and consumption use logical Question identity. An edit creates a new immutable revision. `light`, `medium`, and `deep` classify emotional demand internally and must not become participant-facing progression or gamification.

## Deliverables

- Schema/data migration that backfills every current Question into a logical Question and first immutable revision.
- Revision-pinned references for existing Together and Private occurrences and their projections.
- Final `intensity` field/API/seed/type vocabulary replacing `depth`.
- Logical-ID consumption/no-repeat semantics and revision-aware selection inputs.
- Deactivation for future selection and withdrawal invalidation for unresolved candidates, without inventing policy for Asked or historical withdrawn content.
- Removal of superseded direct mutable-question code in the same change.

## Security and privacy invariants

- Historical shown/Asked content retains the exact revision presented.
- Intensity is internal curation metadata, never a user-facing badge, score, filter, level, or unlock.
- Withdrawal does not silently rewrite historical records or decide the deferred historical-moderation policy.

## Acceptance criteria

- Existing data migrates without losing or changing pinned historical wording/metadata.
- Editing a Question produces a new revision rather than changing an old one.
- `depth` no longer appears in active schema, APIs, seed paths, callers, or participant UI.
- Deactivation preserves pinned history; withdrawal invalidates only unresolved candidates under the accepted current policy.

## Tests

Add migration/backfill, revision immutability, pinning, logical consumption, intensity vocabulary, deactivation, and unresolved-withdrawal tests.

## Manual verification

Change a curated Question after it has been shown, then confirm prior history retains the previous revision while future selection uses the new one.

## Non-goals

Do not run an expand–contract compatibility phase, create a later cleanup ticket, design historical withdrawal moderation, or implement the Private/Together ramps.
