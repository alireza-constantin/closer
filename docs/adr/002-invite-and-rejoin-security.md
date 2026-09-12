# ADR 002: Separate initial invitation from guest replacement

**Status:** Accepted

## Context

Creating a Pair and connecting its second Participant are separate product actions. The creator must be able to use Together before the other person has an account, while later allowing the intended person to claim the stable second slot without exposing sequential database identifiers.

The intended-person name cannot establish identity. A bearer invitation must not be usable to replace an occupied membership, and loss of a guest session is different from both initial claim and registered-account recovery. Credential storage must also limit the impact of a database disclosure without pretending that a hash-only server can reproduce a raw bearer token.

## Decision

Closer uses distinct initial-invitation and guest-rejoin credentials with different issuance, authority, and membership effects.

### Intended-person name

Pair creation stores a required, trimmed, non-unique 1–40 character intended-person name. It is pair-local contextual copy only. It does not create a Participant, authenticate the eventual claimant, reserve a name, or prove that a claimant is the intended person.

The sole active member may edit the value while slot 2 remains unclaimed. Editing does not rotate or revoke credentials. Successful initial claim atomically clears the value and it is not retained as an alias, analytics identity, or hidden claimant metadata. If the Pair terminates unclaimed, the value remains as read-only contextual Pair information.

### Initial invitation issuance and storage

Pair creation does not issue an invitation. Issuance is lazy and occurs only when the active member explicitly chooses Invite/Connect or enters Private while slot 2 remains unclaimed.

An initial invitation is an opaque, cryptographically strong bearer token bound to slot 2. It is single-use, revocable, expires after 7 days, and can never replace an occupied membership or serve as a recovery credential.

The server stores only a cryptographic token hash plus lifecycle metadata. There may be at most one usable initial invitation for the Pair. Issuance reuses an existing valid invitation instead of silently rotating it.

Because the server cannot reverse the hash:

- the issuing browser may redisplay the raw URL only if it retained the credential locally;
- another device may learn that a valid invitation exists and when it expires, but cannot recover its raw URL;
- absence of the raw token on the current device must not trigger silent replacement;
- an explicit `Replace invitation` action atomically revokes the old valid token and creates a fresh credential after warning that the old link will stop working.

Copy, supported native share, and QR encode the same raw URL. They are presentation options, not separate credentials or redemption mechanisms.

### Initial claim

Opening the join screen is a read-only credential check. A valid landing projection may show:

- the inviter's current Participant display name;
- the Pair's immutable Partner/Friend relationship type;
- the intended-person name as contextual copy;
- the claimant's actual Participant display name, once resolved.

An existing Participant keeps their own display name. A new user chooses a Participant display name independently of the intended-person name. Claim requires an explicit `Join space` action. Opening, leaving, or declining the UI does not consume or revoke the bearer invitation.

Redemption succeeds in one transaction only when:

- the Pair remains active;
- the invitation remains valid, unrevoked, unredeemed, and unexpired;
- slot 2 remains unclaimed;
- the claimant is not the Participant in slot 1;
- the claimant and slot-1 Participant do not already share another active, fully claimed Pair.

A validation rejection does not consume the invitation. Successful claim adds the claimant's membership without ending any membership in another Pair, consumes the invitation, clears the intended-person name, begins the first two-member membership era, and ends active pre-claim Together Sessions. The claimant receives no Together history from before their membership.

### Guest rejoin and replacement

A rejoin link applies only when the target slot is occupied by an active guest Participant eligible for guest-session replacement. A registered Participant recovers through normal sign-in or account recovery.

Only the other active Pair member may explicitly issue a rejoin link for the target guest slot; a Participant cannot issue one for their own slot. The rule is symmetric across the two slots. A rejoin token is fresh, high entropy, single-use, revocable, expires after 24 hours, is stored hash-only, and derives no authority from an initial invitation.

Successful redemption does not recover or transfer the former Participant. It creates a new Participant/membership in the same logical slot, ends the former membership with a display-name snapshot, ends the former membership era, closes its Private Conversations as read-only, invalidates unresolved candidates, revokes credentials targeting the old membership, and ends active Together Sessions. A new membership era begins.

The replacement receives no pre-membership Private or Together content. The continuing Participant retains only content they were already authorized to access. Conversation creator authority does not transfer; selecting a category in the new era creates a new Conversation and creator.

Initial claim and guest replacement are therefore distinct:

| Boundary | Before | After | History granted to entrant |
| --- | --- | --- | --- |
| Initial claim | Slot 2 empty | First slot-2 membership; first two-member era | None from pre-claim Together activity |
| Guest replacement | Slot occupied by eligible guest | Old membership/era end; new membership/era begin | None from former era |

Issuance, redemption, expiry, revocation, Pair state, target membership, duplicate-Pair detection, and membership transition are enforced server-side and transactionally. Token possession is necessary but not sufficient authority.

## Consequences

- Pair creation and invitation issuance are separate operations.
- Credential APIs need an existence/expiry projection distinct from raw-token recovery.
- Explicit replacement is a different command from issue/reuse and must be atomic.
- Initial claim serializes with Pair termination and Together mutations.
- Guest replacement serializes with Pair termination, membership changes, credentials, candidates, Private mutations, and Together mutations.
- History authorization follows Participant membership boundaries, not timeless Pair slots.
- The join page may safely provide contextual names without treating the intended-person name as identity.
- Registered-session loss remains normal authentication recovery.

## Alternatives considered

- **Issue an invitation automatically with Pair creation:** rejected because Together and Pair existence do not require a digitally connected second Participant, and unused credentials should not be created preemptively.
- **Store raw invitation tokens server-side:** rejected because only token verification is required and plaintext storage increases credential exposure.
- **Silently rotate when the current device lacks the raw token:** rejected because it unexpectedly invalidates a link that may already have been shared.
- **Use the intended-person name as a placeholder Participant:** rejected because a non-unique label is neither identity nor authentication.
- **Reuse the initial invitation for recovery:** rejected because a retained URL could take over an occupied slot.
- **Treat the Pair slot as the Participant identity:** rejected because it would transfer Private and historical authority to replacement occupants.
- **Transfer the former Participant ID to a replacement:** rejected because the replacement has not proven continuity with that identity.
