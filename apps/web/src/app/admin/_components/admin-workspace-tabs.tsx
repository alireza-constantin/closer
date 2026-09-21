import Link from "next/link";
import type { Route } from "next";

export type AdminQuestionView = "operations" | "private" | "together";

export function AdminWorkspaceTabs({
  active,
  filters,
}: {
  active: AdminQuestionView;
  filters?: Record<string, string | undefined>;
}) {
  const tabs = [
    { id: "operations" as const, label: "Operations" },
    { id: "private" as const, label: "Private" },
    { id: "together" as const, label: "Together" },
  ];
  return (
    <nav
      aria-label="Questions views"
      className="mb-5 flex w-full max-w-full flex-wrap gap-1 rounded-2xl bg-white/70 p-1.5 shadow-sm sm:w-fit"
    >
      {tabs.map((tab) => (
        <QuestionViewLink active={active === tab.id} filters={filters} key={tab.id} tab={tab} />
      ))}
    </nav>
  );
}

function QuestionViewLink({
  active,
  filters,
  tab,
}: {
  active: boolean;
  filters?: Record<string, string | undefined>;
  tab: { id: AdminQuestionView; label: string };
}) {
  const query = new URLSearchParams({ view: tab.id });
  for (const [key, value] of Object.entries(filters ?? {})) if (value) query.set(key, value);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`focus-visible:ring-closer-navy flex min-w-0 flex-1 justify-center rounded-xl px-3 py-2.5 text-sm font-extrabold transition-colors focus-visible:ring-2 focus-visible:outline-none sm:flex-none sm:px-4 ${active ? "bg-closer-coral text-closer-navy shadow-sm" : "text-closer-navy/70 hover:bg-closer-cream"}`}
      href={`/admin/questions?${query.toString()}` as Route}
    >
      {tab.label}
    </Link>
  );
}
