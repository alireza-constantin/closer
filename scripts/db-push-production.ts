import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import dotenv from "dotenv";

const productionEnvFile = resolve(process.cwd(), "apps/web/.env.production.local");

function fail(message: string): never {
  console.error(`Production schema push stopped: ${message}`);
  process.exit(1);
}

if (!existsSync(productionEnvFile)) {
  fail(
    "apps/web/.env.production.local is missing. Create this ignored operator-only file with the verified Production values first.",
  );
}

const fileEnv = dotenv.parse(readFileSync(productionEnvFile, "utf8"));

function required(name: string) {
  const value = fileEnv[name]?.trim();
  if (!value) fail(`${name} must be set in apps/web/.env.production.local.`);
  return value;
}

const target = required("CLOSER_DB_TARGET");
const branch = required("CLOSER_DB_BRANCH");
const databaseName = required("CLOSER_DB_DATABASE");
const directUrl = required("DATABASE_URL_UNPOOLED");

if (target !== "production") {
  fail("CLOSER_DB_TARGET must be exactly production.");
}

if (branch !== "main") {
  fail("CLOSER_DB_BRANCH must be exactly main.");
}

if (databaseName !== "closer_prod") {
  fail("CLOSER_DB_DATABASE must be exactly closer_prod.");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(directUrl);
} catch {
  fail("DATABASE_URL_UNPOOLED is not a valid database URL.");
}

if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
  fail("DATABASE_URL_UNPOOLED must use the PostgreSQL protocol.");
}

const urlDatabaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
if (urlDatabaseName !== databaseName) {
  fail("DATABASE_URL_UNPOOLED does not target closer_prod.");
}

if (parsedUrl.hostname.includes("-pooler")) {
  fail("DATABASE_URL_UNPOOLED must be Neon direct/unpooled, not a pooler URL.");
}

if (!stdin.isTTY || !stdout.isTTY) {
  fail("This command requires an interactive terminal and cannot run unattended.");
}

console.log(
  "Production schema push target verified: Neon branch main, database closer_prod, direct connection.",
);

const readline = createInterface({ input: stdin, output: stdout });
const confirmation = await readline.question(
  "Type PUSH_PRODUCTION_SCHEMA to apply the current schema once: ",
);
readline.close();

if (confirmation !== "PUSH_PRODUCTION_SCHEMA") {
  fail("confirmation phrase did not match.");
}

const childEnv = {
  ...process.env,
  ...fileEnv,
  CLOSER_DB_ENV_FILE: productionEnvFile,
};

const result = spawnSync("bun", ["run", "--filter", "@Closer/db", "db:push"], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
});

if (result.error) {
  fail("could not start the Drizzle schema push process.");
}

process.exit(result.status ?? 1);
