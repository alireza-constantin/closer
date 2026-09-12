# ADR 005: Pair membership eras, termination, and history

**Status:** Accepted

## Context

A Pair has stable logical slots, but a guest Participant in either slot may later be replaced. Slot identity therefore cannot safely authorize all historical Pair content. Closer also needs an irreversible Unpair/End-this-space lifecycle that stops future activity without conflating relationship termination with privacy erasure.

Private Conversations, Together Sessions, credentials, display-name attribution, and history must all agree on the membership configuration in which activity occurred. Concurrency at claim, replacement, and termination boundaries must not produce partially active state or transfer history to a new occupant.

## Decision

Closer adopts the Pair membership era as an internal authorization and history boundary. An era is one continuous configuration of the Pair's active memberships. It is not a user-facing Space and does not require a dedicated database table; the smallest representation that provides a stable, authoritative configuration identity is acceptable.

Automatic Conversation closure must have one lifecycle source of truth. It may be derived from the era or materialized as its direct consequence, but an independent `private_conversation.ended_at` and era end timestamp must not be allowed to disagree.

### Era boundaries

Pair creation begins with slot 1 occupied and slot 2 unclaimed. The first two-member era begins when the initial claim succeeds. The claimant receives no Together activity from before claim, and active pre-claim Together Sessions end at the claim boundary.

Guest replacement ends the current era and begins another in the same Pair. At that boundary:

- the replaced membership ends and freezes its Participant's current display name;
- old-era Private Conversations become read-only;
- unresolved candidates are invalidated without creating Rounds;
- existing Rounds become read-only under their answer/reveal visibility boundary;
- active Together Sessions end;
- the continuing Participant keeps only previously authorized history;
- the replacement receives no pre-membership Private or Together content;
- category selection in the new era creates a new Conversation, creator, numbering from 1, empty consumed-question set, and reset intensity ramp.

Conversation creator authority never transfers across an era boundary.

### Pair termination

Pair termination is an irreversible terminal transition for the entire Pair. Either active member may initiate it without the other's consent.

The user-facing action is:

- `End this space` for a Pair whose second slot is unclaimed;
- `Unpair` for a fully claimed Pair.

Both invoke the same underlying lifecycle. Before committing, the initiating UI requires explicit confirmation that the Pair becomes read-only, Conversations cannot continue, active Together activity ends, invitations stop working, and pairing again creates a new Pair. `Back to space`, `Leave for now`, and any other navigation action never terminate a Pair.

One transaction:

- marks the Pair terminal;
- ends every active membership;
- freezes each ending Participant's current display name on their membership;
- ends the active membership configuration;
- invalidates unresolved candidates without creating Rounds;
- revokes active initial and rejoin credentials;
- ends active Together Sessions.

The operation is idempotent. It does not delete or rewrite existing Private Rounds, answers, Reveal Views, reactions, replies, Together activity, or contextual intended-person name on an unclaimed Pair. Every later Pair-scoped product mutation is rejected.

Pair termination is not account deletion, content erasure, anonymization, or a retention decision.

### Former-Pair and former-era history

History authorization follows Participant membership boundaries rather than slot identity. Active memberships use Participants' current display names. At membership end, the current name is frozen as a historical presentation snapshot; later Participant renames do not rewrite former history.

Ended history is immutable and viewer-specific:

- in a Private Round where fewer than two answers committed, each former Participant may read only their own answer;
- where both answers committed before the boundary, both former Participants may read both answers even if one or both Reveal Views were absent;
- in a Declined Round, any lone answer remains visible only to its author;
- existing reactions and replies remain readable but immutable;
- Together history remains attached to its original Pair and membership configuration;
- an unclaimed terminated Pair may show its retained intended-person name as contextual copy without implying a Participant existed.

A replacement Participant receives no old-era history. A later Pair between the same Participants is independent and cannot continue or inherit old Conversations, numbering, consumption, Sessions, credentials, or history.

### Transaction ordering

Boundary-sensitive mutations serialize so commit order defines the observable result:

- claim versus Pair termination;
- claim versus Together mutation;
- guest replacement versus Together or Private mutation;
- answer versus Pair termination;
- second answer versus Pair termination;
- any Pair-scoped mutation versus Pair termination.

A mutation that commits first remains in authorized read-only history. If termination or era replacement commits first, the later mutation is rejected. If the second answer commits before termination, mutual answer readiness exists and both former Participants may read both answers; if termination commits first, the answer is rejected and the Round remains never-ready.

Reads need not use the same mutation lock, but must project one committed, authorized state.

## Consequences

- Pair, membership, Conversation, candidate, Round, Session, and credential behavior share one authoritative lifecycle boundary.
- History queries require Participant/membership-aware authorization rather than a Pair ID or logical slot alone.
- Membership rows need end-name snapshots or an equivalent immutable attribution source.
- Initial claim and guest replacement must close active pre-boundary Together Sessions.
- Pair termination requires a terminal Pair state, atomic cleanup of active authority, idempotency, and read-only access paths.
- The implementation may choose an explicit era record or an equivalent stable configuration identity, but must not infer replacement access from only the continuing membership's unchanged start time.
- Privacy erasure and moderation remain separate contracts.

## Alternatives considered

- **Authorize history by stable Pair slot:** rejected because a replacement would inherit the former occupant's private content.
- **Model replacement as creator-role transfer:** rejected because the replacement did not create or participate in the old Conversation.
- **Delete an unclaimed Pair on termination:** rejected because it may contain Together history and contextual intended-person information.
- **Allow Pair reactivation or undo:** rejected because an irreversible boundary makes credentials, history, and later re-pairing unambiguous.
- **Treat Unpair as content deletion:** rejected because relationship lifecycle and privacy-erasure rights require different contracts.
- **Keep live display names in former history:** rejected because future renames would rewrite historical attribution outside the ended membership.
