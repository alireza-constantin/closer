import "server-only";

import { env } from "@Closer/env/server";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function hasTrustedAdminMutationOrigin(
  request: Request,
  trustedOrigin = env.BETTER_AUTH_URL,
) {
  if (!unsafeMethods.has(request.method.toUpperCase())) return true;

  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || request.headers.get("sec-fetch-site") === "cross-site") return false;

  try {
    return new URL(requestOrigin).origin === new URL(trustedOrigin).origin;
  } catch {
    return false;
  }
}
