import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { resolveTestDatabaseUrl } from "./test-database";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const environmentFiles = [
  `${repositoryRoot}/.env`,
  `${repositoryRoot}/apps/web/.env`,
  `${repositoryRoot}/apps/web/.env.local`,
];

for (const environmentFile of environmentFiles) {
  if (existsSync(environmentFile)) dotenv.config({ path: environmentFile });
}

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  throw new Error("Integration tests must never run against Production.");
}

if (process.env.CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS !== "1") {
  throw new Error(
    "Destructive integration tests require CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS=1; no database connection was opened.",
  );
}

const testDatabaseUrl = resolveTestDatabaseUrl((name) => process.env[name]);

// Integration tests use only the explicit, local closer_test connection.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.REALTIME_DATABASE_URL = testDatabaseUrl;
