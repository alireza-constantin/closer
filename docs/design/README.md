# Closer V1 Design Direction

## Authority

Product behavior is controlled by [`../PRD.md`](../PRD.md), and technical behavior is controlled by [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and accepted ADRs. Design references control visual direction only.

[`core-private-flow.png`](./core-private-flow.png) is the approved visual source of truth for:

- Pair Home
- Private Question
- Waiting
- Reveal

The reference depicts the selected Pair Home, Private Question, Waiting, and Reveal direction. If this or a future reference image depicts behavior or features that conflict with the product or architecture documentation, follow the documentation.

The Pair Home image was produced before V1 accepted multiple concurrently active Private questions. It remains authoritative for visual language, colors, typography, and component style, but its single Private-state content model is obsolete. Pair Home implementation must follow the PRD's lightweight `Active questions` behavior, including independently derived `Your turn`, `Waiting for <name>`, and `Ready to reveal` items. This task does not prescribe the revised layout or modify the image.

The Together reference in [`together-flow.png`](./together-flow.png) establishes the same visual language for shared-device category selection and question actions. It also illustrates that Together is an immediate, one-phone path; it must not acquire invitation, QR, or waiting-state UI merely because the second pair slot is empty.

## Chosen direction: Soft Modern / Playful

Closer should feel warm, personal, and emotionally safe without becoming childish or visually busy.

- Warm cream or off-white backgrounds.
- Deep navy typography.
- Coral/pink primary accent.
- Peach treatment for Together mode.
- Lavender treatment for Private mode.
- Yellow for Fun.
- Blue for Deep.
- Mint for Memories.
- Soft rounded cards.
- Subtle organic blob shapes.
- Friendly rounded line icons.
- Generous spacing.
- Large question typography.
- Playful but restrained consumer-app styling.

Relationship and Friendship category treatments should fit this system without introducing a larger V1 color taxonomy.

## Experience principles

- Design mobile-first for a PWA and shared-phone Together use.
- Give the current question and primary action clear visual priority.
- Keep concurrent Pair Home active-question states immediately distinguishable through content and hierarchy, not color alone.
- Treat mutual reveal as a central product moment while preserving clarity and restraint.
- Keep waiting calm and informative; do not imply that unrevealed answer content is already on the device.
- Request notification permission only from the contextual waiting action, never during onboarding.
- Make Like, Skip, Next, End session, reactions, and replies understandable and comfortably tappable.
- Preserve accessible contrast, visible focus, readable text, and reduced-motion behavior when motion is introduced later.

## Scope boundary

This design direction does not authorize themes, gamification, chat, inboxes, journals, relationship scores, AI features, or any behavior outside Closer V1. PWA service-worker and Web Push design/implementation are also outside this documentation task.
