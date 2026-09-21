import { redirect } from "next/navigation";

import { AdminAuthorizationError, requireAdmin } from "@/server/auth/admin";
import { getAdminOverview } from "@/server/modules/admin-questions/admin-overview.service";

import { AdminShell } from "./_components/admin-shell";
import { AdminSectionHeading } from "./_components/admin-facets";
import { AdminLogoutButton } from "./_components/admin-logout-button";
import { AdminOverviewWorkspace } from "./_components/admin-overview-workspace";

export default async function AdminHomePage() {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      if (error.status === 401) redirect("/admin/login");
      return (
        <main className="bg-closer-cream text-closer-navy flex min-h-svh items-center justify-center px-6 py-8">
          <section className="rounded-closer-panel shadow-closer-soft w-full max-w-lg bg-white/90 p-7">
            <p className="text-closer-coral text-xs font-extrabold tracking-[.12em] uppercase">
              Closer Admin
            </p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-[-.04em]">
              Admin access required
            </h1>
            <p className="text-closer-muted mt-2 text-sm leading-relaxed">
              {error.status === 503
                ? "Admin access is not configured for this environment."
                : "This account is not configured for the Closer Admin workspace."}
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

  const overview = await getAdminOverview(admin);

  return (
    <AdminShell activeSection="overview" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminSectionHeading
        title="Overview / Needs Attention"
        description="Keep the question catalog healthy and ready for meaningful conversations."
      />
      <AdminOverviewWorkspace data={overview} />
    </AdminShell>
  );
}
