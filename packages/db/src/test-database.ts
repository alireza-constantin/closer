import { isIP } from "node:net";

export const TEST_DATABASE_URL_ENV = "CLOSER_TEST_DATABASE_URL";

export function resolveTestDatabaseUrl(lookup: (name: string) => string | undefined): string {
  const databaseUrl = lookup(TEST_DATABASE_URL_ENV)?.trim();
  if (!databaseUrl) {
    throw new Error(
      `${TEST_DATABASE_URL_ENV} is required for destructive TypeScript integration tests; it never falls back to DATABASE_URL.`,
    );
  }

  const validationError = validateTestDatabaseUrl(databaseUrl);
  if (validationError) throw new Error(validationError);
  return databaseUrl;
}

export function validateTestDatabaseUrl(databaseUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return "CLOSER_TEST_DATABASE_URL must be a valid PostgreSQL URL.";
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (databaseName !== "closer_test") {
    return "CLOSER_TEST_DATABASE_URL must target the exact database name closer_test.";
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    hostname.toLowerCase() === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.startsWith("127."));
  if (!isLoopback) {
    return "CLOSER_TEST_DATABASE_URL must target a loopback or localhost host.";
  }
}
