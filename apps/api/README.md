# Go API foundation

The API uses Go 1.25.1, as declared in `go.mod`. Set `HTTP_ADDR` before
starting the server. `HTTP_SHUTDOWN_TIMEOUT` is optional and defaults to `10s`.

```powershell
$env:HTTP_ADDR = '127.0.0.1:8080'
bun run api:run
```

From the repository root, `bun run api:test` runs the Go tests and
`bun run api:build` writes the server binary under the ignored
`apps/api/build/` directory. `GET /healthz` reports process health;
`GET /readyz` remains unavailable until GO-02 adds the API dependencies.
