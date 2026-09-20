# Domain Docs

## Read before implementation exploration

- The root `CONTEXT.md` glossary.
- The relevant product and architecture documents.
- Every ADR that governs the area being changed.

## Layout

Closer is a single-context repository. The root glossary defines its ubiquitous language; `docs/adr/` contains its architecture decisions.

## Vocabulary and decisions

Use the terms defined by the glossary in tickets, plans, implementation, and tests. Surface an ADR conflict explicitly instead of silently changing an accepted decision.

## Admin V1 and PRIVATE-01

Before mockup or implementation work involving Admin, Question curation, or
Private candidate Skip/Like, read:

- [`docs/admin/ADMIN-SPEC.md`](../admin/ADMIN-SPEC.md) for locked Admin V1 and
  `PRIVATE-01` behavior;
- [`docs/admin/ADMIN-ANALYTICS.md`](../admin/ADMIN-ANALYTICS.md) for canonical
  metric definitions and privacy suppression.

`PRIVATE-01` is consumer-domain behavior, not analytics instrumentation. If an
existing ADR conflicts with its locked candidate-control rules, surface and
amend that ADR before implementation; do not silently follow the stale rule.
