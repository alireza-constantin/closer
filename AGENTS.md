## Frontend architecture conventions

Closer uses:

- Tailwind CSS for component styling
- shadcn/ui for base UI primitives
- React Hook Form for user-input forms
- Zod for form/input validation

The approved Closer Soft Modern / Playful design is authoritative.
Do not fall back to default shadcn styling or generic SaaS/dashboard UI.

### Reuse before creating

Before implementing new UI:

1. Search for an existing shared component, variant, token, helper, or hook.
2. Reuse or extend an existing abstraction when it represents the same semantic concept.
3. Only create a new shared abstraction when there is real repeated semantic behavior or presentation.
4. Keep one-off composition local.

Do not duplicate product knowledge such as:

- category colors/icons/labels
- status styles/labels
- mode styles
- card surface styles
- page shells
- async button behavior
- visibility-aware polling logic

These should have one authoritative implementation.

### KISS / DRY / YAGNI

Follow all three together:

- KISS: prefer simple components and obvious code.
- DRY: remove meaningful repeated product/UI logic.
- YAGNI: do not build abstractions for hypothetical future screens.

A little duplicated layout code is preferable to the wrong abstraction.

Repeated Tailwind utilities such as:

`flex items-center gap-2`

do not automatically require a component.

Repeated semantic product structures usually do.

### Component hierarchy

Prefer this hierarchy:

1. `components/ui/*`
   - shadcn primitives only
   - Button, Input, Textarea, Dialog, etc.

2. Shared Closer components
   - reusable product-level UI
   - PageShell
   - CategoryBadge
   - CategoryCard
   - StatusBadge
   - ModeCard
   - AsyncButton
   - similar real shared concepts

3. Feature components
   - Private-specific, Pair-specific, Together-specific, etc.

Do not put business/product semantics into `components/ui`.

### Avoid god components

Do not create generic components with large configuration APIs just to eliminate duplication.

Prefer:

- QuestionCard
- AnswerCard
- ConversationCard

over:

- UniversalCard with many variants and boolean props.

Prefer semantic props:

`<CategoryBadge category="deep" />`

over styling props:

`<CategoryBadge background="blue" text="navy" icon="..." />`

### Shared variants and tokens

Repeated design values should use Tailwind/theme/CSS tokens.

Repeated semantic visual variants should use CVA or an equivalent existing variant pattern.

Examples:

- category variants
- status variants
- button variants
- mode variants

Do not scatter repeated arbitrary colors/radii across components.

### Forms

All real user-input forms should use:

- React Hook Form
- Zod
- the existing shadcn form primitives where appropriate

Client validation improves UX but never replaces server/domain validation.

Do not use React Hook Form for simple actions such as:

- Like
- Skip
- Next
- reactions
- category selection
- navigation

### Domain boundaries

Shared UI components must not contain:

- authorization rules
- database access
- Better Auth internals
- reveal confidentiality logic
- membership rules
- business-state derivation that belongs on the server/domain layer

Presentation components should receive already-authorized/derived state.

### Refactoring rule

Whenever a new implementation introduces a pattern already present elsewhere:

- reuse the existing implementation, or
- improve the shared abstraction if the semantic concept is genuinely the same.

Do not knowingly introduce a second implementation of the same Closer product concept.

Before completing substantial frontend work, perform a quick duplication review of the files touched.

## Agent skills

## Architecture and file placement

Start code at the narrowest correct ownership scope and promote it only after real reuse appears.

- Route-only implementation belongs beside its route under a private folder such as
  `app/.../_components`, `_api`, `_hooks`, `_types`, or `_utils`. Do not create empty
  private folders preemptively.
- Frontend code shared by routes for one product capability belongs in
  `apps/web/src/features/<feature>/`. Feature folders may contain `api`, `components`,
  `hooks`, `types`, and `utils` only when each has meaningful contents.
- `apps/web/src/components` is reserved for UI reused across unrelated features.
  It must not become a dumping ground for Pair, invitation, Private, or Together UI.
- `apps/web/src/hooks` contains only hooks shared across unrelated features.
  Root `lib` contains technical infrastructure and cross-cutting utilities, not
  product business logic.
- Shared HTTP request/response schemas and serialized DTOs belong in
  `apps/web/src/contracts/<domain>/`. Derive TypeScript values from Zod schemas where
  practical; do not treat database rows as HTTP contracts.
- Web application server code belongs in `apps/web/src/server/`: current-actor
  resolution in `server/auth`, HTTP concerns in `server/http`, and application
  services in `server/modules/<domain>`. The existing `@Closer/db/closer` package is
  the authoritative transactional domain and persistence layer; do not duplicate its
  Pair, invitation, membership-era, Private, or Together invariants in the web app.
- Route handlers in `app/api/**/route.ts` are HTTP adapters. Keep authentication,
  contract parsing, error mapping, and response shaping there; keep domain transitions
  in the server/domain module they call.
- Server Components call server modules directly rather than fetching the app's own
  API routes. Frontend features must not import `server`, and server modules must not
  import frontend feature implementations.
- Avoid broad barrel files, feature-to-feature deep imports, and compatibility
  re-export files after a move. Prefer the configured `@/*` alias to deeply nested
  relative paths.

Prettier is the canonical formatter. Format changed files only unless a full formatting
baseline is explicitly required; do not manually fight its output or bypass the
pre-commit hook.

### Issue tracker

This repository tracks implementation work as local Markdown tickets in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single domain context: the root glossary and the repository ADRs. See `docs/agents/domain.md`.
