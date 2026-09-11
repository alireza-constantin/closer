# Closer domain glossary

This glossary records the product language used across the PRD and architecture documents. It intentionally describes concepts rather than implementation details.

- **Pair**: a Partner or Friend relationship with exactly two logical participant slots.
- **Pair slot**: one stable position in a pair. The second slot may be empty while the pair already exists.
- **Participant**: a person represented in Closer's domain. A participant is distinct from an authentication identity.
- **Active membership**: a participant's current authority to act through one pair slot.
- **Together**: the shared-device mode. One active pair member is sufficient; both people may use the same phone without the second slot being connected.
- **Private**: the independent-answer mode. Both pair slots must be actively connected because each participant answers on their own device.
- **Initial invitation**: a secure URL that claims the empty second slot.
- **Rejoin link**: a fresh secure URL that lets a replacement guest occupy the other participant's eligible slot after guest-session loss. It never transfers the former participant's identity or history.
- **Relationship type**: the pair-level Partner or Friend choice that controls relationship-specific categories.
- **Mode**: the current experience choice, Together or Private. It does not redefine the pair or its relationship type.

Onboarding therefore resolves concepts in this order: relationship type, then mode, then the mode-specific eligibility check.
