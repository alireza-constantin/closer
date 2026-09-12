# ADR 006: Immutable Question revisions and deterministic intensity selection

**Status:** Accepted

## Context

Question text and eligibility metadata will change as content is curated. If Private Rounds and Together history reference one mutable row, an edit can retroactively change what Participants were shown. If consumption follows revision IDs, a wording edit can cause the same logical prompt to repeat. Selection also needs to converge across retries and concurrent devices while producing an intentional warm-up arc rather than arbitrary intensity mixing.

Ordinary content deactivation and emergency safety withdrawal have different operational meanings. They must not be collapsed into one flag that either rewrites history or unexpectedly invalidates an already-presented safe candidate.

## Decision

Closer separates stable logical Question identity from immutable Question revisions.

### Identity and revision pinning

A logical Question retains one stable identity across edits. Every change to user-visible text or selection metadata—including category, relationship fit, mode fit, or intensity—creates a new immutable revision.

The following occurrences pin the exact revision presented:

- a persisted Private Question Candidate;
- the Private Round created by Ask;
- a Together shown-question occurrence.

Ask copies or references the candidate's exact revision; it never re-resolves to the latest revision. Historical wording and metadata therefore remain stable.

Consumption and no-repeat rules use logical Question identity:

- a Private Conversation consumes logical Questions that were Asked or creator-Skipped;
- a Together Session consumes every logical Question it has shown;
- a new revision does not make a consumed Question eligible again in the same scope.

### Deactivation and withdrawal

Ordinary deactivation prevents a revision from future selection. It does not invalidate an unresolved candidate that already pins that revision and does not alter Asked, shown, or historical occurrences.

Emergency withdrawal is a distinct content-safety action. It invalidates unresolved Private candidates so they cannot be Asked. The treatment of already-Asked Private Rounds, already-shown Together occurrences, and historical content is explicitly deferred to a moderation/content-governance contract.

### Question intensity

The canonical metadata name is `intensity`, replacing `depth` over time. Allowed values remain `light`, `medium`, and `deep`:

- **Light:** low-vulnerability, low-stakes, readily answerable prompts suitable for warming up.
- **Medium:** meaningful personal reflection or moderate vulnerability without normally being highly exposing.
- **Deep:** substantial emotional vulnerability, relational disclosure, or potentially difficult reflection.

Intensity describes one revision's emotional demand. It is distinct from the user-facing Deep category; any valid category may contain a deep-intensity revision, and a Deep-category revision may be medium or deep.

Intensity is internal curation and selection metadata in V1. It is not shown as a badge, filter, score, level, unlock, stage, progress indicator, or game mechanic.

### Deterministic selection boundary

Each Private Conversation and Together Session has stable selection context sufficient to produce a deterministic order. At one selection point, the server:

1. determines eligible active, non-withdrawn revisions for category, relationship type, and mode;
2. excludes consumed logical Questions;
3. computes the current preferred intensity;
4. chooses the first intensity band with eligible content using the defined fallback order;
5. deterministically orders candidates within that band using the Conversation- or Session-scoped context;
6. persists the chosen occurrence before returning it.

Retries and concurrent devices converge on the persisted occurrence. Selection is injectable or controllable in tests and does not use answer content, Likes, reactions, replies, or behavioral personalization. New eligible content added later may become selectable but does not replace a persisted candidate.

The fallback order is:

- Light target: Light → Medium → Deep;
- Medium target: Medium → Light → Deep;
- Deep target: Deep → Medium → Light.

### Private intensity ramp

A Private Conversation prefers:

- Light at 0–1 mutually completed Rounds;
- Medium at 2–3 mutually completed Rounds;
- Deep at 4 or more mutually completed Rounds.

A Round is mutually completed only when both answers and both Reveal Views are persisted. Candidate selection, Ask, Skip, Decline, one answer, one Reveal View, question Like, reaction, and reply do not advance the ramp. Deep remains preferred thereafter. A new Conversation in a new membership era starts again at Light.

### Together intensity ramp

A Together Session prefers:

- Light at 0–1 completed `Next` transitions;
- Medium at 2–3 completed `Next` transitions;
- Deep at 4 or more completed `Next` transitions.

`Skip` consumes the current shown Question but does not advance intensity. `Like` neither consumes a new Question nor advances intensity. Deep remains preferred thereafter. A new Together Session starts again at Light and does not inherit progression.

### Exhaustion

A consumed logical Question does not repeat within the same Conversation or Session. When no eligible unused Question remains, the result is `You've reached the end for now.` Selection does not silently cycle.

Private exhaustion does not end or restart the Conversation. If new eligible content is added later, the existing Conversation may continue. Together remains bounded to its current Session; a future Session begins with empty consumption and Light preference.

## Consequences

- Content editing requires new immutable revisions instead of in-place mutation.
- Private and Together occurrences need exact revision references and logical-Question references for consumption.
- The existing `depth` vocabulary and field must migrate to `intensity` without rewriting historical meaning.
- Selection needs stable scoped context, deterministic ordering, persisted outcomes, and soft-band fallback.
- Tests can prove selection behavior without relying on randomness or database row order.
- Deactivation and emergency withdrawal need distinct commands/states.
- Historical withdrawal behavior cannot be implemented until its separate moderation contract is resolved.

## Alternatives considered

- **Keep one mutable Question row:** rejected because edits would rewrite Asked, shown, and historical content.
- **Consume revision IDs:** rejected because a new revision could repeat the same logical Question within one Conversation or Session.
- **Use intensity as an eligibility gate:** rejected because content scarcity should fall back to another band rather than falsely report exhaustion.
- **Shuffle freely:** rejected because retries and concurrent devices need a stable outcome and V1 requires an intentional warm-up arc.
- **Let Likes or answers personalize selection:** rejected because V1 selection is deterministic and non-personalized.
- **Treat deactivation and withdrawal as the same action:** rejected because routine curation and urgent safety invalidation have different effects on persisted candidates and history.
