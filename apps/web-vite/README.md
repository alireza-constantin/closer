# Closer web app

The React Router + Vite application is the production frontend. It includes guest onboarding, Pair creation and invites, Together, Private, history, replacement rejoin, Pair termination, Admin sign-in, question authoring, and analytics.

## Development

Run `bun run dev` from the repository root. Vite proxies `/api` to `http://127.0.0.1:8080` by default. Set `VITE_API_PROXY_TARGET` to use a different local Go API address. Browser requests use same-origin `/api/v1` paths and cookies; production hosting must proxy `/api/*` to the Go API and serve `index.html` for frontend deep links.

## PWA and authenticated data

The app builds an installable PWA. The service worker precaches static application assets and does not configure runtime caching for API or SSE responses. Authenticated API responses are fetched with same-origin credentials. On logout and identity transitions, the client clears in-memory query state; the server remains the authorization boundary for every request.

## Checks

```sh
bun run --filter web-vite test
bun run --filter web-vite check-types
bun run --filter web-vite build
```
