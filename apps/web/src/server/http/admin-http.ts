import "server-only";

import { z } from "zod";

import { CloserDomainError } from "@Closer/db/closer";

import { AdminAuthorizationError, requireAdmin } from "@/server/auth/admin";
import { hasTrustedAdminMutationOrigin } from "@/server/http/admin-origin";

export const adminNoStoreHeaders = { "Cache-Control": "private, no-store" };
export type AdminSession = Awaited<ReturnType<typeof requireAdmin>>;

export type AdminRequestAccess =
  { ok: true; admin: AdminSession; adminUserId: string } | { ok: false; response: Response };

export async function authorizeAdminRequest(request: Request): Promise<AdminRequestAccess> {
  let admin;
  try {
    admin = await requireAdmin(request.headers);
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      const message =
        error.status === 401
          ? "Authentication is required."
          : error.status === 403
            ? "Admin access is required."
            : "Admin access is not configured.";
      return {
        ok: false,
        response: Response.json(
          { error: message },
          { status: error.status, headers: adminNoStoreHeaders },
        ),
      };
    }
    return {
      ok: false,
      response: Response.json(
        { error: "Unable to verify Admin access." },
        { status: 500, headers: adminNoStoreHeaders },
      ),
    };
  }

  if (!hasTrustedAdminMutationOrigin(request)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Request origin is not trusted." },
        { status: 403, headers: adminNoStoreHeaders },
      ),
    };
  }

  return { ok: true, admin, adminUserId: admin.user.id };
}

export async function parseAdminJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<{ data: z.infer<TSchema>; response?: never } | { data?: never; response: Response }> {
  const body: unknown = await request.json().catch(() => undefined);
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      response: Response.json(
        {
          error: "Invalid request.",
          issues: result.error.issues.map(({ path, message }) => ({ path, message })),
        },
        { status: 400, headers: adminNoStoreHeaders },
      ),
    };
  }
  return { data: result.data };
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AdminAuthorizationError) {
    const message =
      error.status === 401
        ? "Authentication is required."
        : error.status === 403
          ? "Admin access is required."
          : "Admin access is not configured.";
    return Response.json(
      { error: message },
      { status: error.status, headers: adminNoStoreHeaders },
    );
  }

  if (error instanceof CloserDomainError) {
    if (error.code === "QUESTION_UNAVAILABLE") {
      return Response.json(
        { error: "Question not found." },
        { status: 404, headers: adminNoStoreHeaders },
      );
    }
    if (
      error.code === "QUESTION_REVISION_CONFLICT" ||
      error.code === "QUESTION_STATE_CONFLICT" ||
      error.code === "QUESTION_REVISION_WITHDRAWN"
    ) {
      return Response.json({ error: error.code }, { status: 409, headers: adminNoStoreHeaders });
    }
    if (error.code === "QUESTION_WITHDRAWAL_REASON_REQUIRED") {
      return Response.json({ error: error.code }, { status: 400, headers: adminNoStoreHeaders });
    }
  }

  return Response.json(
    { error: "Unable to complete the Admin request." },
    { status: 500, headers: adminNoStoreHeaders },
  );
}

export function adminNotFoundResponse() {
  return Response.json(
    { error: "Question not found." },
    { status: 404, headers: adminNoStoreHeaders },
  );
}
