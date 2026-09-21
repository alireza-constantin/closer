import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

dotenv.config({
  path: existsSync("../../apps/web/.env.local")
    ? "../../apps/web/.env.local"
    : "../../apps/web/.env",
});

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));
const journalPath = fileURLToPath(new URL("./migrations/meta/_journal.json", import.meta.url));
const migrationsSchema = "drizzle";
const migrationsTable = "__drizzle_migrations";

type MigrationJournalEntry = {
  tag: string;
  when: number;
};

type PostgresError = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  detail?: unknown;
  hint?: unknown;
  schema?: unknown;
  table?: unknown;
  column?: unknown;
  constraint?: unknown;
};

function readMigrationJournal(): MigrationJournalEntry[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ tag?: unknown; when?: unknown }>;
  };

  return (journal.entries ?? []).flatMap((entry) => {
    if (
      typeof entry.tag !== "string" ||
      !/^[a-z0-9_]+$/.test(entry.tag) ||
      typeof entry.when !== "number"
    ) {
      return [];
    }

    return [{ tag: entry.tag, when: entry.when }];
  });
}

function redactSensitiveText(value: string, databaseUrl: string | undefined) {
  let redacted = databaseUrl ? value.replaceAll(databaseUrl, "<REDACTED DATABASE_URL>") : value;
  redacted = redacted.replace(/\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi, "<REDACTED DATABASE_URL>");
  redacted = redacted.replace(
    /\b(password|passwd|secret|token|api[_-]?key)\s*([=:])\s*([^\s,;)}\]]+)/gi,
    "$1$2<REDACTED>",
  );
  return redacted.replace(/[\r\n]+/g, "\\n");
}

function getErrorField(
  error: unknown,
  field: keyof PostgresError,
  databaseUrl: string | undefined,
) {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as PostgresError)[field];
  if (value === undefined || value === null) return undefined;
  return redactSensitiveText(String(value), databaseUrl);
}

function getNestedErrors(error: unknown) {
  const pending: Array<{ label: string; value: unknown }> = [{ label: "error", value: error }];
  const seen = new Set<object>();
  const nested: Array<{ label: string; value: unknown }> = [];

  while (pending.length > 0 && nested.length < 8) {
    const current = pending.shift();
    if (!current || !current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    nested.push(current);

    const cause = (current.value as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      pending.push({ label: `${current.label}.cause`, value: cause });
    }

    const errors = (current.value as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      errors.forEach((nestedError, index) => {
        pending.push({ label: `${current.label}.errors[${index}]`, value: nestedError });
      });
    }
  }

  return nested;
}

function printMigrationFailure(error: unknown, databaseUrl: string | undefined) {
  console.error("[db:migrate] Migration failed with the following safe diagnostics:");
  for (const nestedError of getNestedErrors(error)) {
    for (const field of [
      "name",
      "message",
      "code",
      "detail",
      "hint",
      "schema",
      "table",
      "column",
      "constraint",
    ] as const) {
      const value = getErrorField(nestedError.value, field, databaseUrl);
      if (value !== undefined)
        console.error(`[db:migrate] ${nestedError.label}.${field}: ${value}`);
    }
  }
}

async function describeMigrationState(pool: Pool, entries: MigrationJournalEntry[]) {
  const tracked = entries.map((entry) => entry.tag).join(", ") || "none";

  try {
    const result = await pool.query<{ created_at: string }>(
      `select created_at from "${migrationsSchema}"."${migrationsTable}" order by created_at desc limit 1`,
    );
    const lastAppliedAt = result.rows[0] ? Number(result.rows[0].created_at) : undefined;
    const pending =
      lastAppliedAt === undefined ? entries : entries.filter((entry) => entry.when > lastAppliedAt);
    const pendingNames = pending.map((entry) => entry.tag).join(", ") || "none";

    return `tracked migrations: ${tracked}; pending candidates: ${pendingNames}`;
  } catch {
    return `tracked migrations: ${tracked}; ledger state unavailable before migration`;
  }
}

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  let pool: Pool | undefined;
  let exitCode = 0;

  try {
    if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

    const entries = readMigrationJournal();
    pool = new Pool({ connectionString: databaseUrl });
    const database = drizzle(pool);

    console.log(`[db:migrate] ${await describeMigrationState(pool, entries)}`);
    console.log("[db:migrate] applying migrations from src/migrations");

    await migrate(database, {
      migrationsFolder,
      migrationsSchema,
      migrationsTable,
    });

    console.log("[db:migrate] migrations applied successfully");
  } catch (error) {
    exitCode = 1;
    printMigrationFailure(error, databaseUrl);
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        exitCode = 1;
        console.error("[db:migrate] Failed to close the database connection:");
        printMigrationFailure(error, databaseUrl);
      }
    }
  }

  return exitCode;
}

process.exitCode = await runMigration();
