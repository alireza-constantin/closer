import { isIP } from "node:net";

export const TEST_DATABASE_URL_ENV = "CLOSER_TEST_DATABASE_URL";
export const LEGACY_TEST_DATABASE_URL_ENV = "CLOSER_LEGACY_TEST_DATABASE_URL";

export function resolveTestDatabaseUrl(lookup: (name: string) => string | undefined): string {
  return resolveDatabaseUrl(lookup, TEST_DATABASE_URL_ENV, "closer_test");
}

export function resolveLegacyTestDatabaseUrl(lookup: (name: string) => string | undefined): string {
  return resolveDatabaseUrl(lookup, LEGACY_TEST_DATABASE_URL_ENV, "closer_legacy_test");
}

export function validateTestDatabaseUrl(databaseUrl: string): string | undefined {
  return validateDatabaseUrl(databaseUrl, "closer_test", TEST_DATABASE_URL_ENV);
}

export function validateLegacyTestDatabaseUrl(databaseUrl: string): string | undefined {
  return validateDatabaseUrl(databaseUrl, "closer_legacy_test", LEGACY_TEST_DATABASE_URL_ENV);
}

function resolveDatabaseUrl(
  lookup: (name: string) => string | undefined,
  environmentVariable: string,
  databaseName: string,
): string {
  const databaseUrl = lookup(environmentVariable)?.trim();
  if (!databaseUrl) {
    throw new Error(
      `${environmentVariable} is required for destructive TypeScript integration tests; it never falls back to another database URL.`,
    );
  }

  const validationError = validateDatabaseUrl(databaseUrl, databaseName, environmentVariable);
  if (validationError) throw new Error(validationError);
  return databaseUrl;
}

function validateDatabaseUrl(
  databaseUrl: string,
  databaseName: string,
  environmentVariable: string,
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return `${environmentVariable} must be a valid PostgreSQL URL.`;
  }

  const actualDatabaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (actualDatabaseName !== databaseName) {
    return `${environmentVariable} must target the exact database name ${databaseName}.`;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    hostname.toLowerCase() === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.startsWith("127."));
  if (!isLoopback) {
    return `${environmentVariable} must target a loopback or localhost host.`;
  }
}
