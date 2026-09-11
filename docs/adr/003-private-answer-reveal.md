# ADR 003: Server-enforced mutual private-answer reveal

**Status:** Accepted

## Context

Private mode depends on trust: both participants receive the same question and answer independently, and neither may access the other's answer until both have submitted for that round. Sending both answers to the client and hiding one with UI or CSS would expose the answer through page data, browser tools, caches, or application state. Closer also needs to let a pair leave one category conversation unfinished, use another topic, and resume the earlier round without weakening confidentiality.

## Decision

Private-answer visibility is a server-side authorization invariant.

Before both persisted answers exist for a given round, an authorized participant may receive their own answer and non-sensitive round status only. The other participant's answer must not appear in serialized server responses, page props, route payloads, logs, caches, behavioral events, or client-side hidden state. Reveal readiness is derived solely from both answers being persisted. Once that condition is true, the server may return both answers together to either authorized active participant in the round.

V1 will not require or model one global round-wide `REVEALED` acknowledgement. Reveal viewing/completion timing is persisted independently for each participant in the round. A participant whose timing is absent sees `Ready to reveal`; after that participant views the reveal, their own state records that it was viewed. Viewing by one participant neither marks the reveal viewed for the other nor changes the other participant's state.

Multiple Private conversations may be active concurrently for one pair, in different categories. A conversation groups one category's sequential rounds, normally has one active instance for that pair/category, and has at most one unresolved current round. Every round independently controls its answers, authorization, reveal readiness, per-participant reveal-view timing, reactions, and optional replies; state in one round has no effect on any other round. An unfinished conversation remains active and can be resumed later without a persisted pause state. A participant may select another category without viewing a reveal-ready round. After a round is reveal-ready, `Next question` creates the next eligible prompt in the same conversation; its retry path must resolve to one current round. Reactions and each participant's optional short reply become available only after that round's mutual-reveal condition is satisfied. A reaction always means the owner reacting to the other participant's answer and is rendered on that answer card. Polling may report that a round is reveal-ready, but it cannot carry the other answer early. Future History groups Private activity by conversation rather than by unrelated round.

Round creation must safely handle an accidental duplicate user action or retry where appropriate, but the system must not impose uniqueness across all active rounds for a pair.

## Consequences

- Private-round reads must be viewer-aware server projections rather than one shared payload hidden differently in the UI.
- Authorization, answer-derived reveal readiness, and the viewer's own reveal-view timing must be checked on every relevant read, not only when rendering the initial page.
- Server caches, logs, behavioral events, and polling responses must not leak unrevealed answer content.
- Database/server integration tests must prove per-round pre-reveal isolation, post-reveal mutual access, independent per-participant reveal-view timing, cross-round isolation, coexistence of distinct active rounds, and safe handling of accidental duplicate creation.
- The reveal can be treated as a deliberate product moment because both answers become available from the same persisted condition.
- Pair Home needs a lightweight per-conversation resume surface instead of one pair-wide Private status, without becoming a messaging inbox.

## Alternatives considered

- **Send both answers and hide one in the UI:** rejected because it is concealment, not authorization.
- **Reveal each answer immediately after submission:** rejected because it creates a first-mover disadvantage and breaks the mutual-reveal promise.
- **Require a global reveal acknowledgement after both answers exist:** rejected because answer persistence already determines confidentiality, while viewing is meaningful per participant rather than per round.
- **Allow only one active conversation per pair:** rejected because it blocks people from leaving a topic unfinished and returning to it later.
- **Persist a paused state immediately:** rejected because V1 can derive `Your turn`, `Waiting`, and `Ready to reveal` from existing per-round data; a distinct state can be added if a future Pause action changes behavior.
