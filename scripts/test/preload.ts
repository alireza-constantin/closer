const explicitIntegrationRun = Bun.argv.some((argument) => argument.includes(".integration.test."));

if (!explicitIntegrationRun) {
  const safeDefaults: Record<string, string> = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://closer:test-only@127.0.0.1:5432/closer_test",
    BETTER_AUTH_SECRET: "closer-test-only-secret-do-not-use-in-production",
    BETTER_AUTH_URL: "http://localhost:3001",
    REALTIME_DATABASE_URL: "postgresql://closer:test-only@127.0.0.1:5432/closer_test",
  };

  for (const [key, value] of Object.entries(safeDefaults)) {
    if (!process.env[key]) process.env[key] = value;
  }
}
