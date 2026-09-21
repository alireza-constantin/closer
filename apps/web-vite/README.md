# Vite frontend foundation

This app is the replacement frontend during the Go/Vite transition. The legacy
Next app remains in `apps/web` as the behavioral reference. The app currently
contains a shell, route boundaries, the shared QueryClient, and the versioned
API transport seam; it does not implement authentication or product flows.

## Reuse review

- **A — reusable as-is:** Closer tokens and shared UI primitives from
  `@Closer/ui`; the legacy favicon and install icons copied into this app's
  `public/favicon` directory.
- **B — reused with framework changes:** the Closer page shell surface is
  shared from `@Closer/ui`; this app composes it with React Router links. Query
  defaults follow the current frontend's TanStack Query policy.
- **C — Next-specific and to be rewritten:** the legacy `layout.tsx`, route
  pages, server components, route handlers, and auth/server providers. Their
  behavior remains documented by the legacy implementation and rewrite
  contracts.
- **D — not carried into this app:** Next metadata/font wrappers and Next
  server APIs. The Vite entry, manifest, and router take their place. The
  legacy app and its files remain untouched as a reference.

## Development

Run `bun run --filter web-vite dev`. Vite serves the SPA locally and proxies
`/api/*` to `http://127.0.0.1:8080` by default. Set
`VITE_API_PROXY_TARGET` to use a different local Go API address.

The PWA precaches built static assets only. Navigation fallback excludes API
and event paths; no runtime cache, authenticated response cache, or offline
mutation queue is configured. Updates wait for the user to reload.
