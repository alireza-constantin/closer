# Closer domain glossary

This glossary records the product language used across the PRD and architecture documents. It intentionally describes concepts rather than implementation details.

- **Pair**: a Partner or Friend relationship with exactly two logical participant slots.
- **Pair slot**: one stable position in a pair. The second slot may be unclaimed while the pair already exists.
- **Participant**: a person represented in Closer's domain, independently of any Pair. A participant is distinct from an authentication identity and may belong to zero Pairs.
- **Intended person name**: the temporary, pair-local label for the person expected to claim a Pair's second slot. It is not a Participant identity and is cleared when the slot is claimed, but remains contextual Pair information if the Pair terminates unclaimed.
  _Avoid_: Placeholder participant, fake participant
- **Space**: the user-facing presentation of one Pair.
- **Active membership**: a participant's current authority to act through one pair slot. A participant may hold active memberships in multiple independent pairs.
- **Pair membership era**: one continuous configuration of a Pair's two active memberships. It is an internal history and authorization boundary, not a user-facing Space or a required database entity.
- **Together**: the shared-device mode. One active pair member is sufficient; both people may use the same phone without the second slot being connected.
- **Together Session**: one bounded use of Together with a start and an end.
- **Private**: the independent-answer mode. Both pair slots must be actively connected because each participant answers on their own device.
- **Private Conversation**: a persistent, resumable category-specific sequence in Private within one Pair membership era. It has no user-triggered finish or restart lifecycle in V1; it becomes read-only when its era ends, and leaving its UI does not end it.
- **Conversation creator**: the Participant who creates a Private Conversation and exclusively controls its pre-round question candidates and progression to later rounds.
  _Avoid_: Pair creator, space owner
- **Private question candidate**: one server-backed eligible question shown only to the Conversation creator before the next Private Round exists.
- **Private Round**: one numbered Question Asked within a Private Conversation. A Declined Round remains a Round, while a candidate Skip creates no Round.
- **Private Answer**: one immutable answer submitted by a Participant for an Asked Private Round. Before both answers exist, each Participant may read only their own.
- **Reveal View**: the persisted fact that one Participant explicitly opened a reveal-ready Private Round. Both Participants' Reveal Views are required for creator progression, but there is no global `REVEALED` state.
- **Private reaction**: one Participant's post-reveal reaction to the other Participant's answer in a Private Round.
- **Private reply**: one Participant's optional post-reveal reply in a Private Round.
- **Mutually completed Private Round**: a Private Round for which both answers and both participants' Reveal views are persisted.
- **Private Ask**: the creator's action that consumes the current candidate by turning it into the next numbered Private Round.
- **Private Skip**: the creator's action that consumes the current candidate without creating a Private Round.
- **Private Decline**: either participant's action, before submitting their own answer, that terminally passes an already-Asked Private Round without mutual reveal.
  _Avoid_: Private Skip, answer retraction
- **Private question Like**: the creator's occurrence-specific, non-public content feedback on a candidate. It neither consumes the candidate nor creates a Private Round.
  _Avoid_: Together Like, Private reaction
- **Consumed Private question**: a question that was asked as a round or skipped in one Private Conversation and therefore cannot be offered again in that conversation.
- **Question**: the stable logical identity of one curated prompt across its revisions.
- **Question revision**: one immutable version of a Question's user-visible content and eligibility metadata. Candidates, Private Rounds, and Together shown-question records pin the exact revision presented.
- **Question intensity**: the internal emotional-demand classification of one Question revision: light, medium, or deep. It is distinct from the user-facing Deep category.
  _Avoid_: Question depth, level, unlock
- **Question deactivation**: the ordinary removal of a Question from future selection without changing or invalidating an already-pinned occurrence.
- **Question withdrawal**: an emergency content-safety action distinct from deactivation. It invalidates unresolved candidates, while treatment of Asked or historical occurrences requires a separate moderation policy.
- **Initial invitation**: a secure URL that claims the unclaimed second slot.
- **Initial claim**: the first occupation of a Pair's second slot through an Initial invitation. It begins the first two-membership era without granting the claimant access to pre-membership Together activity.
- **Rejoin link**: a fresh secure URL that lets a replacement guest occupy the other participant's eligible slot after guest-session loss. It never transfers the former participant's identity or history.
- **Relationship type**: the pair-level Partner or Friend choice that controls relationship-specific categories.
- **Mode**: the current experience choice, Together or Private. It does not redefine the pair or its relationship type.
- **Pair termination**: the terminal transition that ends every active membership in a Pair and makes its authorized history read-only.
- **Unpair**: the user-facing Pair-termination action when both slots are claimed. Either active participant may initiate it.
  _Avoid_: End session, leave for now
- **End this space**: the user-facing Pair-termination action while the second slot remains unclaimed.
- **Membership-end display name**: the Participant display name frozen when a membership ends and used to attribute that membership's historical activity without exposing later name changes.
- **Former-Pair history**: the immutable history of a terminated Pair, visible to each former participant within that participant's membership and Private-reveal boundaries. It attributes former participants with their membership-end display names.

Onboarding creates the Participant before any Pair. Pair creation identifies the intended person and relationship type; mode is selected later within that Pair.
