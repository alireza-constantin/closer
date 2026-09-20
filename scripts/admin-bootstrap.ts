import { existsSync } from "node:fs";

import dotenv from "dotenv";

const envFile = ["apps/web/.env.local", "apps/web/.env", ".env"].find(existsSync);
if (envFile) dotenv.config({ path: envFile });

const [{ env }, { bootstrapAdminAccount }] = await Promise.all([
  import("../packages/env/src/server.ts"),
  import("../packages/auth/src/admin-provisioning.ts"),
]);

try {
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD) {
    throw new Error("Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD first.");
  }

  const result = await bootstrapAdminAccount({
    email: env.ADMIN_BOOTSTRAP_EMAIL,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
    configuredAdminUserId: env.ADMIN_USER_ID,
  });

  console.log(
    `${result.created ? "Created" : "Already configured"} Admin user ID: ${result.userId}`,
  );
  if (result.created)
    console.log("Set ADMIN_USER_ID to this value, then remove ADMIN_BOOTSTRAP_PASSWORD.");
} catch (error) {
  console.error(
    "Admin bootstrap failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
}
