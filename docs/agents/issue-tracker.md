# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The feature spec, when needed, is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; do not combine tickets into one file.
- Each issue records its workflow state on a `Status:` line near the top. New implementation work uses `ready-for-agent`.
- Comments and conversation history append under `## Comments`.

## Publishing and reading

When a skill publishes an issue, create its individual Markdown file under the feature directory. When work references a ticket, read that file directly before acting.

## Admin V1 planning source

[`docs/admin/ADMIN-SPEC.md`](../admin/ADMIN-SPEC.md) is the locked planning
source for the future `admin-v1` feature. Before creating
`.scratch/admin-v1/` issues, use its dependency order and create one issue file
per ticket. Each ticket must include Goal, Scope, Likely files, Domain
invariants, Security requirements, Tests, Acceptance criteria, and Migration
(`YES` or `NO`).
