import "server-only";

import { auth } from "@Closer/auth";
import { env } from "@Closer/env/server";
import { headers } from "next/headers";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export class AdminAuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super(
      status === 401
        ? "Authentication is required."
        : status === 403
          ? "Admin access is required."
          : "Admin access is not configured.",
    );
    this.name = "AdminAuthorizationError";
  }
}

async function resolveAdminSession(
  requestHeaders: Headers,
  configuredAdminUserId: string | undefined,
): Promise<AuthSession> {
  if (!configuredAdminUserId) throw new AdminAuthorizationError(503);

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) throw new AdminAuthorizationError(401);
  if (session.user.id !== configuredAdminUserId) throw new AdminAuthorizationError(403);

  return session;
}

export async function requireAdmin(requestHeaders?: Headers): Promise<AuthSession> {
  return resolveAdminSession(requestHeaders ?? (await headers()), env.ADMIN_USER_ID);
}
