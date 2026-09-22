const testFiles = [
  "packages/auth/src/admin-auth.integration.test.ts",
  "packages/db/src/*.integration.test.ts",
  "apps/web/src/server/modules/admin-questions/*.integration.test.ts",
];

const child = Bun.spawn(
  [
    process.execPath,
    "test",
    "--parallel=1",
    "--path-ignore-patterns",
    "__closer_test_noop__/**",
    ...testFiles,
  ],
  {
    env: {
      ...process.env,
      CLOSER_TEST_MODE: "integration",
    },
    stderr: "inherit",
    stdout: "inherit",
  },
);

process.exit(await child.exited);
