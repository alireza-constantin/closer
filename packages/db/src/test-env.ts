import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

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
    "Integration tests use and clean up Development data. Confirm apps/web/.env.local targets Neon DEVELOPMENT, then set CLOSER_ALLOW_DESTRUCTIVE_DB_TESTS=1 to opt in.",
  );
}

const developmentDatabaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!developmentDatabaseUrl) {
  throw new Error(
    "Integration tests require the Neon DEVELOPMENT DATABASE_URL_UNPOOLED or DATABASE_URL.",
  );
}

// Integration tests use the direct Development connection for all DB access.
process.env.DATABASE_URL = developmentDatabaseUrl;
process.env.REALTIME_DATABASE_URL = developmentDatabaseUrl;
