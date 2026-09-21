import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: existsSync("../../apps/web/.env.local")
    ? "../../apps/web/.env.local"
    : "../../apps/web/.env",
});

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "./src/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl || "",
  },
});
