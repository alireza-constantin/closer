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