import "server-only";

import { redirect } from "next/navigation";

import { AdminAuthorizationError, requireAdmin } from "@/server/auth/admin";

export async function requireAdminPage() {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      if (error.status === 401) redirect("/admin/login");
      if (error.status === 403 || error.status === 503) redirect("/admin");
    }
    throw error;
  }
}
