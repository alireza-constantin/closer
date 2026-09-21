import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const configuredEnvFile = process.env.CLOSER_DB_ENV_FILE;
const envFile = configuredEnvFile
  ? resolve(process.cwd(), configuredEnvFile)
  : existsSync("../../apps/web/.env.local")
    ? "../../apps/web/.env.local"
    : "../../apps/web/.env";

if (configuredEnvFile && !existsSync(envFile)) {
  throw new Error(`Configured database env file does not exist: ${envFile}`);
}

dotenv.config({
  path: envFile,
});

const databaseUrl = configuredEnvFile
  ? process.env.DATABASE_URL_UNPOOLED
  : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

if (!databaseUrl) {
  throw new Error(
    configuredEnvFile
      ? "DATABASE_URL_UNPOOLED is required when CLOSER_DB_ENV_FILE is set."
      : "DATABASE_URL or DATABASE_URL_UNPOOLED is required for Drizzle.",
  );
}

export default defineConfig({
  schema: "./src/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
