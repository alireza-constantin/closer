# Closer V1 Product Requirements

## 1. Product summary

Closer is a mobile-first progressive web app that helps romantic partners and close friends have better conversations through a curated deck of questions. Each relationship is represented by a two-person Pair and shown in the product as a Space.

Closer has two modes:

- **Together** is a shared-device, verbal experience.
- **Private** lets both people answer independently on their own devices before a mutual reveal.

This document is authoritative for V1 product behavior and scope. [`ARCHITECTURE.md`](./ARCHITECTURE.md) defines the technical invariants that support it, and accepted decisions are recorded in [`adr/`](./adr/). [`design/core-private-flow.png`](./design/core-private-flow.png) and [`design/together-flow.png`](./design/together-flow.png) remain authoritative for visual language where they do not conflict with this product contract.

## 2. Participants, Pairs, and Spaces

A Participant is created during onboarding independently of Pair creation. A Participant may have zero, one, or many active Pairs.

Every Pair has:

- exactly two stable logical slots;
- one immutable relationship type: `Partner` or `Friend`;
- zero or one active Participant in each slot;
- its own invitations, conversations, sessions, and history.

There is no separate Space entity. `Space` is the user-facing name for one Pair. Creating or joining a new Space does not replace or merge any existing Space.

At most one active, fully claimed Pair may exist for the same two Participants, regardless of relationship type. Multiple unclaimed Pairs may coexist because an intended-person name is not identity and cannot be used to deduplicate people. After a Pair is terminated, the same two Participants may create a new, independent Pair.

The relationship type cannot be edited in V1. Changing from Partner to Friend, or vice versa, requires terminating the old Pair and creating a new one.

## 3. Onboarding and Pair creation

Onboarding first creates the Participant. A required Participant display name is trimmed, non-unique, and 1–40 characters. The Participant may leave onboarding with no Pair.

Creating a Pair is a separate action:

1. The Participant enters a required intended-person name.
2. The Participant chooses the immutable Partner or Friend relationship type.
3. Closer creates the Pair and places the creator in the first slot.
4. The creator may choose Together, Private, invite the intended person, or return later.

The intended-person name is trimmed, non-unique, and 1–40 characters. It is pair-local contextual copy only: it does not create a fake Participant, authenticate anyone, or prove who will join. While the second slot is unclaimed, the sole active member may edit it without rotating or revoking an invitation.

When the second slot is claimed, the claimant's real Participant identity and display name become authoritative. Closer atomically clears the intended-person name and does not retain it as a hidden alias, claimant identity, or analytics field. If the Pair is terminated before claim, the intended-person name remains as read-only contextual history copy.

## 4. Space entry and selection

The root experience reflects the Participant's active Pairs:

- With zero active Spaces, show first-Space creation as an optional next step, not as Participant creation.
- With one active Space, open that Space's Pair Home through the fast path.
- With two or more active Spaces, show a lightweight `Your spaces` list and never choose one arbitrarily.

Each Space card shows Partner or Friend and either the other Participant's current display name or truthful unclaimed copy. `Create another space` remains available without ending any existing membership.

Pair Home presents `Talk Together` and `Answer Privately` as the primary mode choices. Mode selection never changes the Pair or its relationship type.

## 5. Together mode

Together is for two people using one phone and answering aloud. It requires only one active Pair member, so it is available immediately while the second slot is unclaimed. The other person does not need an account, invitation redemption, or another device.

A Together Session is bounded:

1. An active member chooses a category and starts the Session.
2. Closer shows one eligible question at a time.
3. The pair answers verbally; Closer stores no typed answers.
4. `Like` records feedback on the shown question and does not advance intensity.
5. `Skip` consumes that question for the Session, selects another, and does not advance intensity.
6. `Next` completes the current shown-question transition, advances the intensity ramp, and selects another.
7. `End session` ends only the Together Session.

A logical Question never repeats within the same Together Session. If no unused eligible question remains, Closer shows `You've reached the end for now.` and does not silently cycle.

Every Together Session begins with a soft emotional-intensity ramp:

| Completed `Next` transitions | Preferred intensity |
| ---------------------------- | ------------------- |
| 0–1                          | Light               |
| 2–3                          | Medium              |
| 4 or more                    | Deep                |

The deep preference continues for the remainder of the Session; the pattern does not restart. Intensity is a preference, not an eligibility gate. Fallback is Light → Medium → Deep for a Light target, Medium → Light → Deep for a Medium target, and Deep → Medium → Light for a Deep target. A new Together Session starts again at Light.

Intensity is never shown as a level, score, unlock, badge, or progress indicator.

If an initial claim or guest replacement commits while a pre-boundary Together Session is active, that Session ends. The joining or replacement Participant receives none of its earlier activity. The continuing Participant retains authorized history.

## 6. Invitation and connection

Creating a Pair does not automatically issue an invitation. Closer issues one only when the creator explicitly chooses Invite/Connect or enters Private while the second slot is unclaimed.

There may be one usable initial invitation at a time. If one is still valid, Closer reuses it. The issuing browser may redisplay the raw invitation when it retained the credential locally. Another device may see that an invitation exists and when it expires, but cannot recover the raw link because the server stores only its hash.

When the raw link is unavailable, Closer must not silently rotate a valid invitation. `Replace invitation` is an explicit action that warns the member and atomically revokes the old link before issuing a fresh one.

Before claim, the join experience shows:

- the inviter's current Participant display name;
- the immutable Partner or Friend relationship type;
- the intended-person name as contextual copy;
- the claimant's own actual Participant display name.

Existing Participants keep their own display name. New users choose their Participant display name separately. Claim requires an explicit `Join space` action. Merely opening, leaving, or declining the join screen does not consume or revoke the bearer invitation.

Claim is rejected if the claimant is already the active occupant of the Pair's other slot or if the two Participants already share another active, fully claimed Pair. A rejected claim leaves the invitation usable. A successful initial claim fills the same Pair rather than creating another one.

## 7. Private mode and Shared Open protocol

> The following Shared Open contract supersedes legacy creator-owned wording in
> sections 7–10 and 12. It is the authoritative Private protocol.

Private Conversations are persistent category resources, unique per Pair,
membership era, and category. Either active member may select a shared,
deterministic candidate. Selection creates one question visible to both; both
may answer at once without seeing the other answer. The selection is
provisional until the first answer commits it. A participant may have only one
self-initiated provisional at a time; later generative selection resumes it.
The 30-minute provisional marker is cleanup eligibility, never an automatic
visible disappearance: a later entry preserves a still-referenceable question
and first-answer submission remains valid. An explicitly abandoned unanswered
provisional has no history or consumption.

At most one committed unresolved Shared Open round exists per category. Each
participant may initiate at most one committed unresolved round across the
Pair; answering another member's round does not consume that initiator slot.
One answer permits either member to quietly retire the question, sealing that
answer forever while consuming the Question and freeing the initiator slot.
Two answers require explicit Reveal and cannot be unilaterally retired.

Private does not label who selected a question, permanent askers, chooser
rotation, control requests, quotas, question totals, pending work, or answer
debt. The category hub is a mood choice: it routes receptive work when one is
already present, otherwise lets the member choose a category. Selecting alone
sends no push; first answer and second-answer/reveal-ready transitions use the
existing notification architecture without reminders or nudges.

Private requires both Pair slots to have active Participants. If the second slot is unclaimed, entering Private opens the connection flow and lazily creates or reuses the initial invitation.

Private is organized into persistent, category-specific Conversations. There is no generic Private Session object and no manual Finish or Restart action in V1. Leaving Private is navigation only—`Back to space` or `Leave for now`—and the Conversation remains resumable while the same two memberships remain active.

For a category with no Conversation in the current two-member configuration, the first Participant whose start succeeds creates the Conversation and becomes its immutable creator. Different categories may have different creators.

Only the Conversation creator may:

- see the unresolved pre-round question candidate;
- Like, Ask, or Skip that candidate;
- begin candidate selection after the current Round satisfies the progression rule.

Creator authority does not alternate, transfer, expire, become shared, or permit inactivity takeover in V1.

The non-creator may answer Asked Rounds, reveal, react, reply, view authorized history, and navigate away. Before the first Question is Asked, the non-creator sees `Waiting for <creator> to choose a question.` After both people reveal a Round, the non-creator waits for the creator to choose the next question.

## 8. Private candidate flow

When a Conversation has no current unresolved Round, Closer persists one eligible question candidate and shows it only to the creator. The same candidate survives refreshes, retries, multiple creator devices, and navigation until it is Asked, Skipped, or invalidated by the Pair or membership boundary.

The creator's candidate actions are:

- **Ask:** consumes the candidate, creates the next numbered Private Round, and makes that Question visible to both Participants.
- **Skip:** consumes the candidate for this Conversation, creates no Round, does not increment the Round number, immediately offers another unused eligible candidate, and never appears in Pair Home or user-facing history.
- **Like:** toggles creator-only, occurrence-specific content feedback. It does not consume the candidate, create a Round, change eligibility or numbering, affect reveal/progression, or appear in Pair Home, answers, Reveal, replies, or user-facing history.

Ask and Skip are idempotent and mutually exclusive for a candidate. Exactly one wins if they race. The final Like state becomes immutable when Ask or Skip resolves the candidate. If a Pair or membership boundary invalidates an unresolved candidate, its final Like state may remain internal content-quality feedback but does not become a Round, history item, or consumed Question in another Conversation.

A Conversation's consumed-question set contains logical Questions that were Asked as Rounds or explicitly Skipped by the creator. A Question cannot reappear within that Conversation. Likes and Declines do not independently change consumption: Ask already consumed a Declined Round's Question.

## 9. Private Round flow

Ask creates the next stable Round number, starting at 1 in each Conversation. The Round pins the exact Question wording and metadata presented at Ask time.

Each Participant may independently submit one required answer. An answer is trimmed, 1–2000 characters, and immutable after submission in V1.

Before both answers are persisted:

- each Participant may read only their own answer and non-sensitive state;
- neither answer is sent to the other Participant or hidden in client state;
- either Participant who has not answered may choose `Pass this question`.

Passing an already-Asked Question creates the distinct **Declined** outcome:

- If neither answer exists, either Participant may Decline.
- If one answer exists, only the unanswered Participant may Decline.
- Once both answers exist, Decline is unavailable.
- Decline is terminal, creates no reveal, reaction, or reply state, and keeps the Round in numbering and in the count of questions Asked.
- A submitted answer in a Declined Round remains visible only to its author.
- History shows neutral `Question passed` copy and does not identify who Declined, although actor and time may be retained internally.
- The creator may proceed immediately to the next candidate.
- Once progression moves on, Pair Home does not retain a separate Declined status item for that Round.

Answer and Decline races have one committed result. A Participant cannot both submit and Decline the same answer position.

When both answers exist, the Round is reveal-ready. Each Participant must explicitly open Reveal; their reveal views are recorded independently. Either may reveal first, but the Conversation creator cannot proceed to another candidate until both answers and both reveal views are persisted. There is no timeout, reminder-triggered completion, override, or bypass. Foreground polling may update the creator when the second reveal occurs without exposing answer content early.

After a Participant opens a ready Reveal, both answers are available to that authorized Participant. Post-reveal, each Participant may keep at most one reaction and one optional reply for the Round. A reaction is displayed on the other Participant's answer. A supplied reply is trimmed to 1–500 characters and may be edited or removed by its owner.

The sequential progression within one Conversation is:

```text
creator candidate → Ask → independent answers → independent Reveal views
                  ↘ Skip → another candidate
Asked Round → eligible Decline → terminal passed Round → another creator candidate
both answers + both Reveal views → another creator candidate
```

Other category Conversations remain independently usable while one Conversation waits for an answer, reveal, or creator action.

## 10. Question selection and exhaustion

Selection first applies category, Partner/Friend fit, mode fit, active revision, withdrawal, and consumed-question rules. It then uses a deterministic Conversation- or Session-scoped order so retries and concurrent requests converge on the same choice. Likes, reactions, replies, answer content, and behavioral personalization do not affect V1 selection.

Private Conversations use this soft ramp based only on mutually completed Rounds—Rounds with both answers and both Reveal views:

| Mutually completed Rounds | Preferred intensity |
| ------------------------- | ------------------- |
| 0–1                       | Light               |
| 2–3                       | Medium              |
| 4 or more                 | Deep                |

Candidate selection, Ask, Skip, Decline, one answer, one reveal, question Like, reaction, and reply do not advance the ramp. The deep preference continues without restarting. A new Conversation after guest replacement starts again at Light.

The same intensity fallback order applies as in Together. Within the first available intensity band, deterministic Conversation-scoped ordering chooses the candidate.

When all eligible logical Questions in a Private Conversation are consumed, show `You've reached the end for now.` Do not cycle, restart the category, mark the Conversation ended, or create a replacement Conversation. If new eligible content is added later, the same Conversation may continue, provided no already-persisted candidate is replaced.

## 11. Question content behavior

The initial content target is approximately 80 human-curated logical Questions. User-facing categories are Fun, Deep, Memories, Relationship for Partner Pairs, and Friendship for Friend Pairs.

Each Question has stable identity across immutable revisions. Editing wording, category, relationship fit, mode fit, or intensity creates a new revision. A candidate, Private Round, or shown Together question keeps the exact revision it originally presented; later edits do not rewrite history.

`Question intensity` describes the emotional demand of one revision:

- **Light:** low-vulnerability, low-stakes, and readily answerable; suitable for warming up.
- **Medium:** meaningful personal reflection or moderate vulnerability without normally being highly exposing.
- **Deep:** substantial emotional vulnerability, relational disclosure, or potentially difficult reflection.

Intensity is distinct from the user-facing Deep category. A Deep-category Question may be medium or deep intensity, and another category may contain a deep-intensity Question. Intensity is internal selection metadata in V1.

Ordinary deactivation removes a Question from future selection without invalidating an already-persisted candidate or historical occurrence. Emergency withdrawal is a separate safety action: it invalidates an unresolved candidate. Treatment of already-Asked or historical withdrawn content is deferred to a moderation contract.

## 12. Guest replacement

Guest rejoin is replacement, not identity recovery. It applies only to an active slot occupied by a guest who lost their session. A registered Participant uses normal sign-in or account recovery. Only the other active member may create a fresh, revocable, single-use rejoin link for the eligible guest slot; a Participant cannot issue it for their own slot.

Successful replacement:

- creates a new Participant and active membership for the same logical slot;
- ends the former membership and freezes that former Participant's display name for history;
- closes all old-configuration Private Conversations as read-only;
- invalidates unresolved candidates without creating Rounds;
- ends active Together Sessions;
- gives the replacement no Private or Together content from before their membership;
- lets the continuing Participant retain only history they were already authorized to access.

Selecting a category after replacement creates a new Private Conversation with a new immutable creator, numbering from 1, an empty consumed-question set, and a Light intensity preference. Creator authority never transfers from the replaced Participant.

## 13. Pair termination

Either active member may unilaterally and irreversibly terminate a Pair. The UI calls this:

- `End this space` when the second slot is unclaimed;
- `Unpair` when both slots are claimed.

The initiating member must confirm a warning that the Pair becomes read-only, Conversations cannot continue, active Together activity ends, invitations stop working, and reconnecting later creates a new Pair.

Termination:

- ends all active memberships;
- invalidates outstanding initial and rejoin credentials;
- invalidates unresolved Private candidates without creating Rounds;
- ends active Together Sessions;
- makes all Pair content immutable;
- preserves authorized Former-Pair history rather than deleting the Pair.

`Back to space`, `Leave for now`, and Private navigation never terminate the Pair. The other member need not consent or acknowledge termination. Notifications may inform them later but are not required for the transition.

A future Pair between the same Participants is entirely separate. It cannot resume, inherit, or merge the former Pair's Private Conversations, consumed Questions, Together Sessions, or history.

## 14. Former-Pair history

When an active membership ends through Pair termination or guest replacement, Closer freezes that Participant's current display name on the ended membership. Active views use the Participant's current display name; former history uses the frozen membership-end name and does not change if the Participant later renames themselves.

Within an ended Pair or ended membership configuration:

- content cannot continue or mutate;
- a Participant may read only history they were authorized to access through their own membership;
- in a never-ready Private Round, each former Participant may read only their own submitted answer;
- if both answers were persisted before the boundary, both former Participants may read both answers even if one or both had not opened Reveal before the boundary;
- existing reactions and replies remain readable and immutable;
- Declined Rounds remain neutral, read-only `Question passed` history, with any submitted answer visible only to its author;
- Together history remains attached to the former Pair and respects membership-start boundaries.

An unclaimed terminated Pair may show its retained intended-person name as contextual history copy without implying that a Participant existed.

## 15. V1 scope

V1 includes:

- guest-first Participant onboarding with optional later registration;
- multiple independent two-person Partner or Friend Spaces;
- Together Sessions and persistent Private Conversations;
- lazy secure initial invitations and guest-replacement rejoin links;
- creator-owned candidate selection with Ask, Skip, Like, and Decline;
- immutable answers, mutual reveal, reactions, and short replies;
- deterministic non-repeating question selection with soft intensity ramps;
- irreversible Pair termination and authorized read-only Former-Pair history;
- PWA delivery, contextual push opt-in later in V1, and raw behavioral event logging.

## 16. Non-goals and deferred contracts

V1 does not include groups or family mode, AI-generated questions or an AI coach, behavioral recommendations, chat or arbitrary messaging, nested threads, unread infrastructure, journals, goals, scoring, streaks, XP, subscriptions, premium tiers, themes, or participant-visible intensity gamification.

The following contracts remain explicitly unresolved and must not be inferred from Pair termination or this document:

- account deletion and permanent erasure;
- retention duration and anonymization;
- deletion rights of former Participants;
- handling of already-Asked or historical Questions after emergency withdrawal;
- broader moderation and content-governance policy;
- notification and reminder behavior beyond state-neutral delivery;
- exact storage representation of membership boundaries and automatic Conversation closure.

Pair termination is not account deletion or a privacy-erasure request. A production-ready privacy and erasure contract is required before Closer is considered production-ready, but it is outside this Pair/Private lifecycle specification.

## 17. Validation goals

V1 should establish whether people can:

- onboard without being forced to create a Pair;
- create and independently manage multiple understandable Spaces;
- use Together immediately with an unclaimed second slot;
- connect the intended person through a safe and comprehensible invitation flow;
- trust the Private answer and reveal boundary;
- understand creator-owned question choice without making Private feel like chat;
- resume sequential category Conversations across navigation;
- experience a gentle Light-to-Medium-to-Deep question arc;
- terminate a Pair with clear consequences and later understand read-only history;
- recover from guest-session loss without transferring identity or prior history.

Validation must never weaken server-side identity, membership, credential, confidentiality, history, concurrency, or termination invariants.
