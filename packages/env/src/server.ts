import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function getVercelOrigin() {
  const vercelUrl =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!vercelUrl) return undefined;
  return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
  ...process.env,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? vercelOrigin,
};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    // Use the direct Neon connection for explicit schema operations when one is configured.
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    // LISTEN needs a session-capable connection. Configure this separately when
    // DATABASE_URL points at a transaction pooler.
    REALTIME_DATABASE_URL: z.string().min(1).optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    ADMIN_USER_ID: z.string().min(1).optional(),
    ADMIN_BOOTSTRAP_EMAIL: z.email().optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).max(128).optional(),
    ADMIN_RECOVERY_PASSWORD: z.string().min(8).max(128).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
