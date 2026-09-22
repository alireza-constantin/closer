const legacyDatabaseUrl = process.env.CLOSER_LEGACY_TEST_DATABASE_URL?.trim();
if (!legacyDatabaseUrl) throw new Error("CLOSER_LEGACY_TEST_DATABASE_URL is required.");

const testEnvironment = {
  ...process.env,
  DATABASE_URL: legacyDatabaseUrl,
  DATABASE_URL_UNPOOLED: legacyDatabaseUrl,
  CLOSER_TEST_MODE: "integration",
  CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS: "1",
  CLOSER_TEST_DATABASE_URL: "",
  ADMIN_USER_ID: "",
  BETTER_AUTH_SECRET: "closer-legacy-test-secret-do-not-use-in-production",
  BETTER_AUTH_URL: "http://localhost:3001",
  NODE_ENV: "test",
};

async function run(command: string[], cwd = process.cwd(), env = testEnvironment) {
  const child = Bun.spawn(command, { cwd, env, stderr: "inherit", stdout: "inherit" });
  return child.exited;
}

async function resetLegacyDatabase(seed: boolean) {
  const resetExitCode = await run(
    [process.execPath, "run", "src/prepare-legacy.ts"],
    "packages/db",
    { ...testEnvironment, CLOSER_LEGACY_RESET: "1" },
  );
  if (resetExitCode !== 0) return resetExitCode;

  const schemaExitCode = await run(["bunx", "drizzle-kit", "push", "--force"], "packages/db");
  if (schemaExitCode !== 0) return schemaExitCode;

  if (seed) {
    const seedExitCode = await run(
      [process.execPath, "run", "src/prepare-legacy.ts"],
      "packages/db",
    );
    if (seedExitCode !== 0) return seedExitCode;
  }
  return 0;
}

async function runTests(patterns: string[]) {
  const testFiles = patterns.flatMap((pattern) =>
    pattern.includes("*")
      ? [...new Bun.Glob(pattern).scanSync({ cwd: process.cwd(), onlyFiles: true })]
      : [pattern],
  );
  return run([
    process.execPath,
    "test",
    "--parallel=1",
    "--path-ignore-patterns",
    "__closer_test_noop__/**",
    ...testFiles,
  ]);
}

const adminExitCode = await resetLegacyDatabase(false);
if (adminExitCode !== 0) process.exit(adminExitCode);
const adminTestExitCode = await runTests([
  "packages/auth/src/admin-auth.integration.test.ts",
  "apps/web/src/server/modules/admin-questions/*.integration.test.ts",
]);
if (adminTestExitCode !== 0) process.exit(adminTestExitCode);

const databaseExitCode = await resetLegacyDatabase(true);
if (databaseExitCode !== 0) process.exit(databaseExitCode);
process.exit(await runTests(["packages/db/src/*.integration.test.ts"]));
