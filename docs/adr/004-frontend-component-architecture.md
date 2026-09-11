# ADR 004: Frontend Component Architecture

## Status

Accepted

## Context

Closer's early UI was implemented quickly and accumulated repeated Tailwind styles,
markup structures, category mappings, status rendering, layout shells, and other
presentation logic.

As the product grows to Private, Together, History, onboarding, and future flows,
copying these implementations would increase visual inconsistency and maintenance cost.

At the same time, aggressively abstracting every repeated utility class would create
an overly generic design system and make the product harder to understand.

Closer therefore needs a small, semantic component architecture that balances:

- KISS
- DRY
- YAGNI

## Decision

Closer will use:

- Tailwind CSS for styling
- shadcn/ui for low-level accessible primitives
- CVA or equivalent variant patterns for legitimate semantic variants
- React Hook Form + Zod for real forms
- Closer-specific shared components for repeated product concepts

The approved Closer visual identity remains authoritative over shadcn defaults.

### Layers

#### UI primitives

`components/ui/*`

Contains generic shadcn-level primitives such as:

- Button
- Input
- Textarea
- Dialog

These components must not contain Closer domain semantics.

#### Shared Closer UI

Contains reusable product concepts such as:

- page shells
- category presentation
- status presentation
- mode cards
- common product surfaces

#### Feature UI

Contains feature-specific components such as:

- Private question/reveal UI
- Pair/invite UI
- Together session UI

Feature components may compose shared Closer components and shadcn primitives.

## Abstraction rule

Repetition is classified before refactoring.

- repeated design value → token
- repeated semantic visual variant → CVA/shared variant
- repeated semantic UI element → shared component
- repeated feature structure → feature component
- coincidentally similar markup → may remain local

Repeated basic Tailwind layout utilities are not automatically abstractions.

## Product knowledge

Product-wide mappings must have one authoritative implementation.

Examples:

- category label/color/icon
- mode presentation
- status presentation
- shared design tokens

These must not be independently recreated in multiple features.

## Component API rule

Components should expose semantic APIs rather than styling APIs.

Preferred:

`<CategoryBadge category="deep" />`

Avoid:

`<CategoryBadge color="blue" radius="full" icon="bubble" />`

Large configurable "god components" are explicitly avoided.

Composition is preferred.

## Forms

Real user-input forms use React Hook Form and Zod.

Client validation does not replace server-side validation or domain constraints.

## Consequences

Benefits:

- more consistent Closer UI
- less product-knowledge duplication
- easier visual changes
- smaller feature components
- clearer ownership boundaries

Costs:

- some shared abstractions must be maintained
- developers/agents must search existing components before creating new ones
- some intentional duplication will remain where abstraction would reduce clarity

## Non-goals

This ADR does not require:

- zero duplicate Tailwind utilities
- a standalone design-system package
- Storybook
- a generic component framework
- abstractions for future features that do not yet exist