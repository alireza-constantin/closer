import { redirect } from "next/navigation";
import type { Route } from "next";

import { AdminAuthorizationError, requireAdmin } from "@/server/auth/admin";
import { AdminLogoutButton } from "./_components/admin-logout-button";

export default async function AdminHomePage() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      if (error.status === 401) redirect("/admin/login" as Route);
      return (
        <main className="bg-closer-cream text-closer-navy flex min-h-svh items-center justify-center px-6 py-8">
          <section className="rounded-closer-panel shadow-closer-soft w-full max-w-lg bg-white/80 p-7">
            <h1 className="text-2xl font-extrabold tracking-[-.04em]">Admin access required</h1>
            <p className="text-closer-muted mt-2 text-sm">
              This account is not configured for the Closer Admin workspace.
            </p>
            <div className="mt-5">
              <AdminLogoutButton />
            </div>
          </section>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="bg-closer-cream text-closer-navy min-h-svh px-6 py-8">
      <section className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-closer-coral text-sm font-extrabold tracking-[.12em] uppercase">
              Closer Admin
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-[-.05em]">
              Admin access is ready
            </h1>
          </div>
          <AdminLogoutButton />
        </header>
        <p className="text-closer-muted mt-5 max-w-xl">
          The protected catalog workspace will appear here as Admin V1 is completed.
        </p>
      </section>
    </main>
  );
}
