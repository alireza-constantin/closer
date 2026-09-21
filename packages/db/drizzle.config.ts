import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path:
    process.env.NODE_ENV === "test"
      ? existsSync("../../apps/web/.env.test.local")
        ? "../../apps/web/.env.test.local"
        : "../../apps/web/.env.test"
      : existsSync("../../apps/web/.env.local")
        ? "../../apps/web/.env.local"
        : "../../apps/web/.env",
});

const databaseUrl =
  process.env.NODE_ENV === "test"
    ? (process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL)
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl || "",
  },
});
