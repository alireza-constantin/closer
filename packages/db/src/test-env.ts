import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const environmentFiles = [
  `${repositoryRoot}/.env`,
  `${repositoryRoot}/apps/web/.env`,
  `${repositoryRoot}/apps/web/.env.local`,
  `${repositoryRoot}/apps/web/.env.test`,
  `${repositoryRoot}/apps/web/.env.test.local`,
];

for (const environmentFile of environmentFiles) {
  if (existsSync(environmentFile)) dotenv.config({ path: environmentFile });
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Integration tests require TEST_DATABASE_URL for a dedicated Neon test branch.");
}

if (process.env.DATABASE_URL === testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must not reuse DATABASE_URL.");
}

// Production code continues to read DATABASE_URL. Only this test process maps
// the dedicated test branch into that role before importing the DB package.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.REALTIME_DATABASE_URL = testDatabaseUrl;
