# 10 — Private answer, Decline, Reveal, and progression

Status: ready-for-agent

Blocked by: 09

## Goal

Complete the sequential Private Round lifecycle: confidential independent answers, terminal Decline, independent Reveal Views, and the both-revealed creator progression gate.

## Authoritative contract

Closer V1 PRD section 9; Closer V1 Architecture sections 6–7 and 12; ADR 003; ADR 005.

## Current → required behavior

Each member can submit one immutable trimmed 1–2000-character answer. Before both exist, a member sees only their own answer and non-sensitive status. An unanswered participant may `Pass this question`, yielding terminal Decline: no reveal/reaction/reply; any lone answer remains author-only; neutral history does not identify the decliner; the creator can continue to a candidate. When both answers persist, Reveal is ready independently. Both participants must explicitly record Reveal Views before only the immutable creator can request the next candidate. No timeout, bypass, or personal-view shortcut exists. Post-reveal reaction/reply behavior remains bounded and immutable where the current contract says so.

## Deliverables

- Confidential answer command/projections and stable immutable answer behavior.
- Decline state, actor/time audit boundary, neutral history projection, and answer/Decline race serialization.
- Independent Reveal View persistence and authorized post-reveal answer, reaction, and reply projections.
- Server-enforced creator-only progression gate requiring both answers and both Reveal Views, with foreground polling only as presentation refresh.

## Security and privacy invariants

- Answers never arrive in the other participant's client state before that participant's authorized reveal.
- A declined lone answer never leaks through history, reveal, reactions, replies, or summaries.
- No one can bypass the second participant's Reveal View.

## Acceptance criteria

- Answering and Declining the same position race to one result; two answers preclude Decline.
- A Declined Round keeps its number and Asked count, displays neutral passed copy, and lets the creator continue.
- Both answers make Reveal ready; each participant records their own view independently.
- The creator waits after their own reveal until the other Reveal View exists; the non-creator can never choose the next candidate.
- Reactions/replies are unavailable for Declined Rounds and authorized only after reveal for ordinary Rounds.

## Tests

Add confidentiality/projection tests, answer/Decline races, Decline history visibility, independent reveal, creator progression, polling state, and post-reveal interaction coverage.

## Manual verification

Exercise one-answer-then-pass and two-answer reveal paths on separate devices, including creator-first reveal and non-creator-first reveal.

## Non-goals

Do not add timers, reminders, reveal bypass, manual Conversation finish/restart, or Former-Pair history UI.
