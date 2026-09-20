import { db } from "@Closer/db";
import * as schema from "@Closer/db/schema/auth";
import { env } from "@Closer/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins/anonymous";

const database = drizzleAdapter(db, {
  provider: "pg",
  schema,
});

const sharedOptions = {
  database,
  trustedOrigins: [env.BETTER_AUTH_URL],
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
};

export function createAuth() {
  return betterAuth({
    ...sharedOptions,
    emailAndPassword: {
      enabled: true,
    },
    plugins: [anonymous(), nextCookies()],
  });
}

export const auth = createAuth();

export function createAdminAuth() {
  return betterAuth({
    ...sharedOptions,
    basePath: "/api/admin-auth",
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [nextCookies()],
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
  });
}

// Admin sign-in has its own path so its persistent IP bucket does not change
// rate limiting for consumer sign-in.
export const adminAuth = createAdminAuth();

// Provisioning uses Better Auth's credential creation without creating an
// interactive session for the command-line operator.
export const provisioningAuth = betterAuth({
  ...sharedOptions,
  emailAndPassword: { enabled: true, autoSignIn: false },
  plugins: [anonymous(), nextCookies()],
});
