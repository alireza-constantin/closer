import { and, eq } from "drizzle-orm";

import { db } from "@Closer/db";
import { account, session, user } from "@Closer/db/schema/auth";
import { env } from "@Closer/env/server";

import { auth, provisioningAuth } from "./index";

export async function bootstrapAdminAccount(input: {
  email: string;
  password: string;
  configuredAdminUserId?: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (!email || input.password.length < 8 || input.password.length > 128)
    throw new Error("Admin bootstrap credentials are invalid.");

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing) {
    if (input.configuredAdminUserId && existing.id === input.configuredAdminUserId)
      return { userId: existing.id, created: false };
    throw new Error(
      "The bootstrap email already belongs to an account that is not the configured Admin.",
    );
  }

  const created = await provisioningAuth.api.signUpEmail({
    body: { email, name: "Closer Admin", password: input.password },
  });
  const [persisted] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!persisted || persisted.id !== created.user.id)
    throw new Error("Admin bootstrap did not create the requested account.");

  return { userId: persisted.id, created: true };
}

export async function recoverAdminAccountPassword(password: string) {
  const adminUserId = env.ADMIN_USER_ID;
  if (!adminUserId) throw new Error("Set ADMIN_USER_ID before recovery.");
  if (password.length < 8 || password.length > 128)
    throw new Error("Admin recovery credentials are invalid.");

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, adminUserId))
    .limit(1);
  if (!existingUser) throw new Error("The configured Admin account does not exist.");

  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, adminUserId),
        eq(account.providerId, "credential"),
        eq(account.issuer, "local:credential"),
        eq(account.accountId, adminUserId),
      ),
    )
    .limit(1);
  if (!credential) throw new Error("The configured Admin has no password credential to recover.");

  const context = await auth.$context;
  const passwordHash = await context.password.hash(password);

  return db.transaction(async (transaction) => {
    const [currentCredential] = await transaction
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.id, credential.id),
          eq(account.userId, adminUserId),
          eq(account.providerId, "credential"),
          eq(account.issuer, "local:credential"),
          eq(account.accountId, adminUserId),
        ),
      )
      .limit(1);
    if (!currentCredential) throw new Error("The configured Admin credential no longer exists.");

    await transaction
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, currentCredential.id));
    const revokedSessions = await transaction
      .delete(session)
      .where(eq(session.userId, adminUserId))
      .returning({ id: session.id });

    return { revokedSessionCount: revokedSessions.length };
  });
}
