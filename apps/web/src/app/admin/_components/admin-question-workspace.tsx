import Link from "next/link";
import type { Route } from "next";

import { ActivityBadge, CategoryValue, IntensityValue, RevisionHealthBadge } from "./admin-facets";
import { AdminWorkspaceTabs, type AdminQuestionView } from "./admin-workspace-tabs";
import type { listAdminQuestions } from "@/server/modules/admin-questions/admin-question.service";

type AdminQuestionList = Awaited<ReturnType<typeof listAdminQuestions>>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function fitLabel(value: string) {
  if (value === "both") return "Both";
  return value[0]?.toUpperCase() + value.slice(1);
}

export function AdminQuestionWorkspace({
  data,
  view,
  filters,
}: {
  data: AdminQuestionList;
  view: AdminQuestionView;
  filters: {
    search?: string;
    category?: string;
    intensity?: string;
    relationshipFit?: string;
    modeFit?: string;
    activity?: string;
    revisionHealth?: string;
  };
}) {
  const start = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.page * data.pageSize, data.total);
  const maxPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  const newQuestionHref = "/admin/questions/new" as Route;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <AdminWorkspaceTabs active={view} filters={filters} />
        {view === "operations" ? (
          <Link
            className="bg-closer-coral focus-visible:ring-closer-navy inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none"
            href={newQuestionHref}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>{" "}
            New question
          </Link>
        ) : null}
      </div>

      {view === "operations" ? (
        <>
          <form
            action="/admin/questions"
            className="rounded-closer-panel shadow-closer-soft mb-5 bg-white/85 p-4"
            method="get"
          >
            <input name="view" type="hidden" value="operations" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-closer-muted flex min-w-0 flex-col gap-1.5 text-xs font-bold xl:col-span-1">
                Search questions
                <input
                  className="border-closer-navy/15 bg-closer-cream text-closer-navy focus-visible:ring-closer-navy min-h-10 rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-2"
                  defaultValue={filters.search}
                  name="search"
                  placeholder="Search wording…"
                  type="search"
                />
              </label>
              <FilterSelect
                label="Category"
                name="category"
                value={filters.category}
                options={[
                  ["fun", "Fun"],
                  ["deep", "Deep"],
                  ["memories", "Memories"],
                  ["relationship", "Relationship"],
                  ["friendship", "Friendship"],
                ]}
              />
              <FilterSelect
                label="Intensity"
                name="intensity"
                value={filters.intensity}
                options={[
                  ["light", "Light"],
                  ["medium", "Medium"],
                  ["deep", "Deep"],
                ]}
              />
              <FilterSelect
                label="Relationship fit"
                name="relationshipFit"
                value={filters.relationshipFit}
                options={[
                  ["both", "Both"],
                  ["partner", "Partner"],
                  ["friend", "Friend"],
                ]}
              />
              <FilterSelect
                label="Mode fit"
                name="modeFit"
                value={filters.modeFit}
                options={[
                  ["both", "Both"],
                  ["together", "Together"],
                  ["private", "Private"],
                ]}
              />
              <FilterSelect
                label="Activity"
                name="activity"
                value={filters.activity}
                options={[
                  ["active", "Active"],
                  ["inactive", "Inactive"],
                ]}
              />
              <FilterSelect
                label="Revision health"
                name="revisionHealth"
                value={filters.revisionHealth}
                options={[
                  ["safe", "Safe"],
                  ["withdrawn", "Current revision withdrawn"],
                ]}
              />
              <div className="flex items-end gap-2">
                <button
                  className="bg-closer-navy focus-visible:ring-closer-coral min-h-10 rounded-xl px-4 text-sm font-bold text-white focus-visible:ring-2 focus-visible:outline-none"
                  type="submit"
                >
                  Apply filters
                </button>
                <Link
                  className="text-closer-navy focus-visible:ring-closer-navy min-h-10 rounded-xl px-3 py-2.5 text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  href={"/admin/questions?view=operations" as Route}
                >
                  Clear
                </Link>
              </div>
            </div>
          </form>
          <section
            aria-label="Question catalog operations"
            className="rounded-closer-panel shadow-closer-soft overflow-hidden bg-white/90"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 md:px-5">
              <p className="text-sm font-extrabold">{data.total.toLocaleString("en")} questions</p>
              <p className="text-closer-muted text-xs">
                Activity and revision health are shown separately.
              </p>
            </div>
            <div
              aria-label="Question operations table"
              className="overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
              role="region"
              tabIndex={0}
            >
              <table className="w-full min-w-[1030px] border-collapse text-left text-sm">
                <thead className="bg-closer-cream/80 text-closer-muted text-xs">
                  <tr>
                    <th className="px-4 py-3 font-bold" scope="col">
                      Question
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Category
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Intensity
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Relationship fit
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Mode fit
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Activity
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Revision health
                    </th>
                    <th className="px-3 py-3 font-bold" scope="col">
                      Current revision
                    </th>
                    <th className="px-4 py-3 font-bold" scope="col">
                      Last change
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-closer-navy/8 divide-y">
                  {data.items.map((item) => (
                    <tr className="hover:bg-closer-cream/50" key={item.questionId}>
                      <th className="max-w-[320px] px-4 py-3 text-left font-semibold" scope="row">
                        <Link
                          className="text-closer-navy focus-visible:ring-closer-navy line-clamp-2 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                          href={`/admin/questions/${item.questionId}` as Route}
                        >
                          {item.currentRevision.text}
                        </Link>
                      </th>
                      <td className="px-3 py-3">
                        <CategoryValue category={item.currentRevision.category} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="sr-only">Intensity: </span>
                        <IntensityValue intensity={item.currentRevision.intensity} />
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold">
                        {fitLabel(item.currentRevision.relationshipFit)}
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold">
                        {fitLabel(item.currentRevision.modeFit)}
                      </td>
                      <td className="px-3 py-3">
                        <ActivityBadge active={item.activity === "active"} />
                      </td>
                      <td className="px-3 py-3">
                        <RevisionHealthBadge withdrawn={item.revisionHealth === "withdrawn"} />
                      </td>
                      <td className="px-3 py-3 text-xs font-bold">
                        v{item.currentRevision.revisionNumber}
                      </td>
                      <td className="text-closer-muted px-4 py-3 text-xs whitespace-nowrap">
                        {formatDate(item.lastChangedAt)}
                      </td>
                    </tr>
                  ))}
                  {data.items.length === 0 ? (
                    <tr>
                      <td className="px-5 py-12 text-center text-sm" colSpan={9}>
                        No questions match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="border-closer-navy/10 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 md:px-5">
              <p aria-live="polite" className="text-closer-muted text-xs">
                Showing {start}–{end} of {data.total.toLocaleString("en")}
              </p>
              <div className="flex items-center gap-2">
                <PageLink page={data.page - 1} disabled={data.page <= 1} filters={filters} />
                <span className="text-xs font-bold">
                  Page {data.page} of {maxPage}
                </span>
                <PageLink
                  page={data.page + 1}
                  disabled={data.page >= maxPage}
                  filters={filters}
                  next
                />
              </div>
            </div>
          </section>
        </>
      ) : (
        <AnalyticsWorkspacePlaceholder view={view} />
      )}
    </>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: Array<[string, string]>;
}) {
  return (
    <label className="text-closer-muted flex min-w-0 flex-col gap-1.5 text-xs font-bold">
      {label}
      <select
        className="border-closer-navy/15 bg-closer-cream text-closer-navy focus-visible:ring-closer-navy min-h-10 rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-2"
        defaultValue={value ?? ""}
        name={name}
      >
        <option value="">All</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function PageLink({
  page,
  filters,
  disabled,
  next = false,
}: {
  page: number;
  filters: Record<string, string | undefined>;
  disabled: boolean;
  next?: boolean;
}) {
  const query = new URLSearchParams({ view: "operations", page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return disabled ? (
    <span
      aria-disabled="true"
      className="border-closer-navy/10 text-closer-muted/50 rounded-lg border px-3 py-2 text-xs font-bold"
    >
      {next ? "Next" : "Previous"}
    </span>
  ) : (
    <Link
      className="border-closer-navy/20 focus-visible:ring-closer-navy hover:bg-closer-cream rounded-lg border px-3 py-2 text-xs font-bold focus-visible:ring-2 focus-visible:outline-none"
      href={`/admin/questions?${query.toString()}` as Route}
    >
      {next ? "Next" : "Previous"}
    </Link>
  );
}

function AnalyticsWorkspacePlaceholder({ view }: { view: "private" | "together" }) {
  const privateView = view === "private";
  return (
    <section
      aria-labelledby="analytics-heading"
      className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold" id="analytics-heading">
            {privateView ? "Private question analytics" : "Together question analytics"}
          </h2>
          <p className="text-closer-muted mt-1 text-sm">All time · Current revision</p>
        </div>
        <p className="text-closer-muted text-xs">Question-level aggregates only</p>
      </div>
      <div className="border-closer-navy/10 mt-5 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="bg-closer-cream/80 text-closer-muted text-xs">
            <tr>
              <th className="px-4 py-3 font-bold" scope="col">
                Question
              </th>
              <th className="px-3 py-3 font-bold" scope="col">
                Category
              </th>
              {(privateView
                ? [
                    "Valid Offers",
                    "Decisions",
                    "Decision Rate",
                    "Ask Rate",
                    "Skip Rate",
                    "Like Rate",
                  ]
                : ["Shown", "Decisions", "Continue Rate", "Skip Rate", "Like Rate"]
              ).map((label) => (
                <th className="px-3 py-3 font-bold" key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                className="text-closer-muted px-4 py-12 text-center text-sm"
                colSpan={privateView ? 8 : 7}
              >
                Analytics values will appear here when the protected projections are connected. No
                metric values are shown yet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
