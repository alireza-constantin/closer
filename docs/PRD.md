# Closer V1 Product Requirements

## 1. Product summary

Closer is a mobile-first progressive web app for exactly two people: romantic partners or close friends. It helps a pair have better conversations through a curated deck of questions in two modes: a shared-device verbal experience called Together and an independent-answer experience called Private.

This document is authoritative for V1 product behavior and scope. Architecture documentation defines the technical invariants that support this behavior. [`design/core-private-flow.png`](./design/core-private-flow.png) is the approved visual source of truth for the visual language and for Private Question, Waiting, and Reveal. Its Pair Home styling remains authoritative, but its Private-mode content model predates category-scoped Private conversations; the behavior defined here takes precedence.

## 2. Target users

- Romantic partners who want an easy prompt for meaningful or playful conversation.
- Two close friends who want the same experience without relationship-specific assumptions.
- People who want to begin as guests and decide later whether to register.

Every V1 pair has exactly two logical participant slots and one relationship type: `partner` or `friend`. Groups and family configurations are outside V1.

Creating a pair and connecting its second participant are separate actions. A pair may exist with only its first slot occupied. The relationship type belongs to the pair; the mode is a choice about the experience the pair wants right now.

## 3. Core product promise

Closer makes it easy for two people to start a worthwhile conversation without setup friction. A pair can talk together from one phone or answer privately with a guaranteed mutual reveal: neither person can see the other's private answer until both have answered.

The onboarding hierarchy is relationship first, mode second:

```text
Who are you using Closer with? → Partner or Friend → How do you want to connect? → Together or Private
```

## 4. Together mode

Together is for two people who are physically together and sharing one phone.

Together requires only the requesting participant's active pair membership. The second slot may be empty: the other person does not need an active guest session, Closer open on another device, an invite redemption, or a QR scan. Choosing Together goes directly to category selection and its shared-device session.

1. One participant starts a Together session.
2. Closer displays one eligible question card at a time.
3. The pair reads the question aloud and answers verbally.
4. The shared device offers `Like`, `Skip`, `Next`, and `End session`.
5. The pair chooses one category when the session starts. `Next` and `Skip` select another eligible question in that same category and session; they do not reopen category selection.
6. The session continues until the user explicitly ends it; there is no fixed card count. A question already shown in that session is not repeated while unused eligible questions remain.

Together mode never creates typed answer records. Like, Skip, and Next are pair/session-level signals. Because the phone is shared, those actions are intentionally not attributed to the individual who tapped. The participant who started the session may be known.

## 5. Private mode

Private mode gives both active participants the same question and lets each answer independently.

Private requires both logical slots to be actively connected. If the second slot is empty, the user sees `Connect your person` with the existing secure invitation URL presented as a link, QR code, and (when supported) native share action. Invitation is therefore part of entering Private, not a prerequisite for using Closer or Together.

1. Choosing a category starts or resumes one Private conversation for that pair and category. A conversation owns a sequential run of eligible Private rounds.
2. Its current eligible question starts the next Private round. A conversation has at most one unresolved current round at a time.
3. Each participant can submit their own required answer independently. The submitted value is trimmed, must contain 1–2000 characters, and cannot be edited after submission in V1.
4. Before both answers exist, each participant may access only their own answer and round status.
5. Neither answer is sent to the other participant before mutual reveal.
6. When both answers are persisted, the round becomes reveal-ready and either participant may access both answers.
7. Reveal viewing is tracked independently per participant. One participant viewing the reveal does not mark it viewed for the other participant, and the round has no global `REVEALED` acknowledgement.
8. In the post-reveal experience, each participant may have at most one reaction and one optional short reply for the round. A reaction represents that participant's reaction to the *other* participant's answer and is shown on that answer card to both authorized participants.

Multiple Private conversations may be active concurrently for the same pair, such as Deep, Fun, and Memories. A conversation groups the sequential rounds in one category; it normally has one active conversation per category and at most one unresolved current round. Older revealed rounds remain part of that conversation rather than becoming unrelated Active Questions. A participant may leave an unfinished Deep conversation, start or resume Fun, and later return to the same Deep round unchanged. When a round is reveal-ready and viewed, `Next question` adds its next round to that same conversation without reopening category selection. Reveal readiness or reveal viewing in one conversation never blocks another category conversation.

V1 does not need a persisted `paused` state. An unfinished round remains active, and the UI derives `Your turn` or `Waiting for <name>` from that participant's answer position. Once both answers exist, the UI derives either `Ready to reveal` or reveal already viewed from that participant's own reveal-view timing. Round creation must safely handle accidental duplicate submissions or retries where appropriate, without imposing pair-wide uniqueness across active rounds.

## 6. V1 scope

V1 includes:

- Pair relationship types: Partner and Friend.
- Exactly two active pair slots.
- Guest-first access with optional later registration.
- Pair creation and a secure invitation URL for the empty second slot.
- A secure rejoin flow for guest-session loss.
- Together mode and Private mode.
- Multiple independently active Private conversations with a lightweight resume surface.
- Server-enforced mutual reveal.
- An initial target of approximately 80 curated questions.
- Question categories: Fun, Deep, Memories, and one relationship-specific category: Relationship for Partner pairs or Friendship for Friend pairs.
- Skip and Like/Reaction behavior appropriate to each mode.
- One optional short post-reveal reply per participant.
- Simple chronological history.
- PWA delivery.
- Contextual web-push opt-in later in V1.
- Raw behavioral event logging.

## 7. Explicit non-goals

V1 does not include:

- AI-generated questions or an AI coach.
- A recommendation engine.
- Groups or family mode.
- Streaks, XP, gamification, relationship scores, or goals.
- Subscriptions, premium tiers, or themes.
- A chat inbox, arbitrary messaging, nested threads, typing indicators, unread-message infrastructure, general-purpose chat, or journals.

These are exclusions, not placeholders for speculative V2 requirements.

## 8. Main user flows

### Guest-first pair creation and invitation

1. A guest provides a required display name when their participant is created. The trimmed name must contain 1–40 characters and need not be unique.
2. The guest chooses Partner or Friend and creates a pair, occupying the first logical slot.
3. Closer asks how they want to connect: Together proceeds immediately, while Private checks whether the second slot is occupied.
4. If the user chooses Private before the second person joins, Closer creates or reuses the initial invitation and shows `Connect your person`.
5. The invited person opens the URL or scans its QR presentation, provides a valid display name when their guest participant is created, and claims the empty slot.
6. Redemption is single-purpose: the old URL cannot later replace either participant or reclaim an occupied slot.

If the initial invitation expires while the second slot remains empty, the active member may generate a fresh initial invitation. V1 may also allow a participant to change their own display name later.

The invitation link and QR code always carry the same opaque URL. QR is only a presentation of the existing secure join flow; it is not a second joining mechanism.

### Optional registration

A guest may register later. Registration may change the Better Auth user identity, but it must not change the domain participant identity or ownership of pair membership, answers, reactions, replies, history, and behavioral events.

### Rejoining after guest-session loss

This replacement flow applies only when the participant occupying the target slot is a guest who has lost the guest session. A registered participant who loses a device or session must use normal sign-in or account recovery and cannot be replaced through guest rejoin.

1. The participant who still has access explicitly requests a rejoin link for the other guest-occupied logical slot; a participant cannot generate a replacement link for themselves.
2. Closer creates a fresh, high-entropy, single-use, revocable rejoin URL that expires after 24 hours.
3. Successful redemption creates a new domain `participant.id` and a new active membership in the target logical slot.
4. The replacement participant may see pair history only from the beginning of that new active membership onward.

The previous participant identity remains distinct, and no earlier Private answers, reactions, replies, Together sessions, or other pre-membership pair history is transferred automatically. The continuing participant may retain access to historical interactions in which they were authorized to participate. The flow is symmetric: either active member can generate a rejoin link for the other eligible guest slot. The redeemed initial invitation is never a recovery credential.

Where a rejoin link is shown, its exact URL may also be copied, shared, or displayed as a QR code. The QR presentation uses the same rejoin URL and does not change the symmetric authority rule.

### Together session

The pair chooses a category, starts a session on one phone, and moves through one eligible card at a time with Like, Skip, or Next. Next and Skip remain inside the selected category and session. The pair answers verbally and manually ends the session. No answer text is collected or stored.

### Private conversation and round

The pair selects a category to create or resume its Private conversation. The conversation presents one current question at a time; each participant answers independently, and the server withholds the other answer until both have submitted for that round. Both answers then become available together whenever either participant opens the reveal; each participant's viewing is tracked independently. Reactions and one optional short reply per participant become available in the post-reveal experience. `Next question` stays in the same conversation and category. The pair may have other category conversations in different states, and either participant may return to Pair Home to switch topics without first viewing a ready reveal.

### History

Participants can review a simple chronological history limited by their own authorization. Future Private history groups activity by conversation (for example, `Deep — 4 questions`) rather than presenting each question as an unrelated top-level history item; opening that group may later expose its revealed rounds. History does not snapshot display names; wherever a participant is named, it renders that participant's current display name. A replacement participant may see pair history only from the beginning of their new active membership onward; they do not gain access to any earlier Private, Together, or other pair activity. The continuing participant may retain access to earlier interactions in which they were authorized to participate.

## 9. Important UI states

Pair Home is mode-oriented and presents `Talk Together` and `Answer Privately` as its two primary actions, even while the second slot is empty. `Talk Together` always goes to category selection. `Answer Privately` goes to category selection when both slots are connected and to `Connect your person` when the second slot is empty. When active Private conversations exist, Pair Home also provides a lightweight `Your conversations` summary. Each item represents a category conversation, its current question, its question count, and one clear participant-relative state:

| Current-round state | Current participant status/action |
| --- | --- |
| Active; current participant has not answered | `Your turn` and open to answer |
| Active; current participant has answered and the other has not | `Waiting for <name>` and open to revisit |
| Both answers persisted; current participant has not viewed reveal | `Ready to reveal` and open to reveal |
| Both answers persisted; current participant has viewed reveal | Ready for next question and open to continue |

Participants can open any conversation's current round, revisit one while waiting, open any reveal-ready round, or select another category without unrelated conversations blocking them. A conversation cannot create another unresolved round while it is waiting; from a revealed question, `Next question` continues directly in that same conversation and category. The summary remains conversation-based and lightweight; it is not an inbox, messaging system, folder hierarchy, or source of unread-message semantics. The PRD does not prescribe its final layout.

Additional required states:

- Empty second slot: Together is available immediately; Private explains that the second person needs to connect and offers the invitation as a link, QR code, and supported native share action.
- Both slots actively joined: Together and Private modes are available without an unnecessary invitation screen.
- Waiting after a Private answer: the participant may choose `Notify me when <name> answers`.
- iOS push unavailable until Home Screen installation: show installation guidance before requesting notification permission.
- Reveal: both answers appear together, followed by reactions and optional short replies.
- Together session: question card plus Like, Skip, Next, and End session controls.

Notification permission must not be requested during initial onboarding.

### Participant and Private-content rules

- A participant display name is required at guest participant creation or join. It is trimmed, must contain 1–40 characters, and is not unique. A participant may change only their own display name if name editing is exposed in V1.
- History renders each participant's current display name and does not preserve historical name snapshots.
- A Private answer is required, trimmed, and must contain 1–2000 characters. It cannot be edited after submission in V1.
- A post-reveal reply is optional. When supplied, it is trimmed and must contain 1–500 characters. Each participant may have at most one reply per Private round and may edit or remove their own reply.
- Each participant may have at most one reaction per Private round and may change or remove their own reaction. Their reaction is attached to the other participant's answer card, not their own.

## 10. Question and content rules

The initial target is approximately 80 human-curated questions. V1 metadata remains deliberately small:

| Field | Allowed values |
| --- | --- |
| `category` | Fun, Deep, Memories, Relationship, Friendship |
| `relationship_fit` | `both`, `partner`, `friend` |
| `mode_fit` | `both`, `together`, `private` |
| `depth` | `light`, `medium`, `deep` |

The category and relationship-fit combination is a content invariant:

- `Relationship` requires `relationship_fit = partner`.
- `Friendship` requires `relationship_fit = friend`.
- Fun, Deep, and Memories may use `both`, `partner`, or `friend`.

Invalid combinations such as Relationship/Friend or Friendship/Partner must not occur. Question selection must respect relationship and mode fit. The curated set should be reviewed for reasonable coverage across relationship type and depth; V1 does not add richer taxonomy or machine-generated content.

## 11. V1 validation goals

V1 should establish whether:

- Two people can begin as guests, form the intended pair, and understand who the experience is for.
- A secure invite flow gets the second person into the correct empty slot without creating recovery risk.
- Together mode creates a low-friction shared conversation without collecting answer text.
- Private mode's waiting and mutual-reveal sequence is understandable, trustworthy, and emotionally satisfying.
- Multiple active Private conversations remain easy to resume and understand without making Closer feel like a chat product.
- Users find enough variety and appropriate depth in the curated question deck across Partner and Friend pairs.
- Participants return to start another conversation and find chronological history useful.
- Contextual notification opt-in after submitting a Private answer feels relevant rather than intrusive.
- The product can observe core behavioral events without using those events as a recommendation system.

Validation must not weaken the server-side privacy, pair-slot, invite, rejoin, or participant-identity invariants defined in the architecture and ADRs.
