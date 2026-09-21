import { redirect } from "next/navigation";

import { AdminAuthorizationError, requireAdmin } from "@/server/auth/admin";

import { AdminShell } from "./_components/admin-shell";
import { AdminSectionHeading } from "./_components/admin-facets";
import { AdminLogoutButton } from "./_components/admin-logout-button";

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

  return (
    <AdminShell activeSection="overview" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminSectionHeading
        title="Overview / Needs Attention"
        description="Keep the question catalog healthy and ready for meaningful conversations."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <section
          aria-labelledby="inventory-heading"
          className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-extrabold" id="inventory-heading">
                Inventory lanes needing attention
              </h2>
              <p className="text-closer-muted mt-1 text-xs">Category × relationship × mode</p>
            </div>
          </div>
          <p className="text-closer-muted bg-closer-cream mt-8 rounded-xl px-4 py-6 text-center text-sm">
            Inventory lanes will appear here when operational projections are available.
          </p>
        </section>
        <section
          aria-labelledby="withdrawn-heading"
          className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-extrabold" id="withdrawn-heading">
              Questions with withdrawn current revisions
            </h2>
            <span aria-hidden="true" className="text-closer-coral text-lg">
              !
            </span>
          </div>
          <p className="text-closer-muted bg-closer-cream mt-8 rounded-xl px-4 py-6 text-center text-sm">
            Questions that need a safe replacement revision will appear here.
          </p>
        </section>
        <section
          aria-labelledby="activity-heading"
          className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:col-span-2 md:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-extrabold" id="activity-heading">
              Recent editorial activity
            </h2>
            <span className="text-closer-muted text-xs">Admin actions only</span>
          </div>
          <p className="text-closer-muted bg-closer-cream mt-8 rounded-xl px-4 py-6 text-center text-sm">
            Recent question and revision changes will appear here.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
