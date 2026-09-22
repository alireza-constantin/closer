import { describe, expect, test } from "bun:test";

import { resolveTestDatabaseUrl, validateTestDatabaseUrl } from "./test-database";

describe("destructive integration database boundary", () => {
  test("requires an explicit test-only environment variable", () => {
    expect(() => resolveTestDatabaseUrl(() => undefined)).toThrow("CLOSER_TEST_DATABASE_URL");
  });

  test.each([
    "postgres://tester:secret@localhost:5432/closer_dev",
    "postgres://tester:secret@db.example.test:5432/closer_test",
    "postgres://tester:secret@ep.example.neon.tech:5432/closer_test",
  ])("rejects unsafe target %s", (databaseUrl) => {
    expect(validateTestDatabaseUrl(databaseUrl)).toBeTruthy();
  });

  test("accepts a loopback closer_test target", () => {
    expect(
      resolveTestDatabaseUrl(() => "postgres://tester:secret@127.0.0.1:5432/closer_test"),
    ).toContain("closer_test");
  });
});
