import { existsSync } from "node:fs";

import dotenv from "dotenv";

const envFile = ["apps/web/.env.local", "apps/web/.env", ".env"].find(existsSync);
if (envFile) dotenv.config({ path: envFile });

const [{ env }, { recoverAdminAccountPassword }] = await Promise.all([
  import("../packages/env/src/server.ts"),
  import("../packages/auth/src/admin-provisioning.ts"),
]);

try {
  if (!env.ADMIN_USER_ID) throw new Error("Set ADMIN_USER_ID before recovery.");
  if (!env.ADMIN_RECOVERY_PASSWORD) throw new Error("Set ADMIN_RECOVERY_PASSWORD before recovery.");

  const result = await recoverAdminAccountPassword(env.ADMIN_RECOVERY_PASSWORD);

  console.log(
    `Recovered configured Admin ${env.ADMIN_USER_ID}; revoked ${result.revokedSessionCount} session(s).`,
  );
  console.log("Remove ADMIN_RECOVERY_PASSWORD from the environment.");
} catch (error) {
  console.error("Admin recovery failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}
