<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Closer frontend conventions

- Use Tailwind CSS utilities for component and page styling. Keep global CSS limited to imports, semantic tokens, font/base setup, safe-area helpers, reduced-motion handling, and small shared keyframes when utilities are not a good fit.
- Use the shared shadcn/ui primitives from `@Closer/ui/components/*` for common controls and compose product-specific Closer components for category cards, mode cards, question cards, answers, and conversation states.
- Preserve the approved Closer Soft Modern / Playful design language. shadcn defaults are implementation primitives, not Closer's visual direction.
- Use React Hook Form with Zod schemas for real user-input forms. Client validation improves feedback but never replaces server/domain validation.
- Prefer small product-oriented components over a generic design-system abstraction layer.
- Avoid component-specific traditional CSS unless there is a strong technical reason that Tailwind composition cannot express cleanly.
