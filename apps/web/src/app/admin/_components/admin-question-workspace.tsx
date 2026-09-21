import Link from "next/link";
import type { Route } from "next";

import type {
  AdminPrivateQuestionAnalyticsItem,
  AdminQuestionAnalyticsQuery,
  AdminTogetherQuestionAnalyticsItem,
} from "@/contracts/admin/question.schema";

import { AdminQuestionFilters } from "./admin-question-filters";
import {
  PrivateAnalyticsTable,
  TogetherAnalyticsTable,
} from "./admin-question-analytics-workspace";
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
  revisionScope,
  analytics,
}: {
  data: AdminQuestionList;
  view: AdminQuestionView;
  revisionScope: AdminQuestionAnalyticsQuery["revisionScope"];
  analytics?: AdminPrivateQuestionAnalyticsItem[] | AdminTogetherQuestionAnalyticsItem[];
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
        <AdminWorkspaceTabs
          active={view}
          filters={{ ...filters, ...(view === "operations" ? {} : { revisionScope }) }}
        />
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

      <AdminQuestionFilters filters={filters} revisionScope={revisionScope} view={view} />

      {view === "operations" ? (
        <>
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
                <PageLink
                  page={data.page - 1}
                  disabled={data.page <= 1}
                  filters={filters}
                  view="operations"
                />
                <span className="text-xs font-bold">
                  Page {data.page} of {maxPage}
                </span>
                <PageLink
                  page={data.page + 1}
                  disabled={data.page >= maxPage}
                  filters={filters}
                  view="operations"
                  next
                />
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          {view === "private" ? (
            <PrivateAnalyticsTable
              data={data}
              metrics={(analytics ?? []) as AdminPrivateQuestionAnalyticsItem[]}
              revisionScope={revisionScope}
            />
          ) : (
            <TogetherAnalyticsTable
              data={data}
              metrics={(analytics ?? []) as AdminTogetherQuestionAnalyticsItem[]}
              revisionScope={revisionScope}
            />
          )}
          <QuestionPagination
            data={data}
            filters={filters}
            revisionScope={revisionScope}
            view={view}
          />
        </>
      )}
    </>
  );
}

function PageLink({
  page,
  filters,
  disabled,
  view,
  revisionScope,
  next = false,
}: {
  page: number;
  filters: Record<string, string | undefined>;
  disabled: boolean;
  view: AdminQuestionView;
  revisionScope?: AdminQuestionAnalyticsQuery["revisionScope"];
  next?: boolean;
}) {
  const query = new URLSearchParams({ view, page: String(page) });
  if (view !== "operations" && revisionScope) query.set("revisionScope", revisionScope);
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

function QuestionPagination({
  data,
  filters,
  revisionScope,
  view,
}: {
  data: AdminQuestionList;
  filters: Record<string, string | undefined>;
  revisionScope: AdminQuestionAnalyticsQuery["revisionScope"];
  view: "private" | "together";
}) {
  const start = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.page * data.pageSize, data.total);
  const maxPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="border-closer-navy/10 flex flex-wrap items-center justify-between gap-3 border-x border-b bg-white/90 px-4 py-3 md:px-5">
      <p aria-live="polite" className="text-closer-muted text-xs">
        Showing {start}–{end} of {data.total.toLocaleString("en")}
      </p>
      <div className="flex items-center gap-2">
        <PageLink
          page={data.page - 1}
          disabled={data.page <= 1}
          filters={filters}
          revisionScope={revisionScope}
          view={view}
        />
        <span className="text-xs font-bold">
          Page {data.page} of {maxPage}
        </span>
        <PageLink
          page={data.page + 1}
          disabled={data.page >= maxPage}
          filters={filters}
          revisionScope={revisionScope}
          view={view}
          next
        />
      </div>
    </div>
  );
}
