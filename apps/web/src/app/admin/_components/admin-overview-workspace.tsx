import Link from "next/link";
import type { Route } from "next";

import type { getAdminOverview } from "@/server/modules/admin-questions/admin-overview.service";

import { CategoryValue } from "./admin-facets";

type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function actionLabel(action: string) {
  return (
    {
      activated: "Activated",
      reactivated: "Reactivated",
      deactivated: "Deactivated",
      revision_withdrawn: "Revision withdrawn",
    }[action] ?? action
  );
}

function InventoryLaneList({
  title,
  lanes,
  level,
}: {
  title: string;
  lanes: AdminOverview["criticalInventoryLanes"];
  level: "critical" | "low";
}) {
  return (
    <section aria-label={`${title} inventory lanes`} className="mt-5">
      <h3 className="text-closer-muted text-xs font-extrabold tracking-wide uppercase">{title}</h3>
      {lanes.length ? (
        <ul className="mt-2 space-y-2">
          {lanes.map((lane) => (
            <li
              className="border-closer-navy/10 flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white/75 px-3 py-3"
              key={`${lane.category}:${lane.relationship}:${lane.mode}`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                  <span>
                    <span className="sr-only">Category: </span>
                    <CategoryValue category={lane.category} />
                  </span>
                  <span aria-hidden="true" className="text-closer-muted">
                    ·
                  </span>
                  <span>{lane.relationship === "partner" ? "Partner" : "Friend"}</span>
                  <span aria-hidden="true" className="text-closer-muted">
                    ·
                  </span>
                  <span>{lane.mode === "private" ? "Private" : "Together"}</span>
                </p>
                <p className="text-closer-muted mt-1 text-xs">
                  Intensity breakdown (diagnostic): Light {lane.intensityBreakdown.light} · Medium{" "}
                  {lane.intensityBreakdown.medium} · Deep {lane.intensityBreakdown.deep}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${level === "critical" ? "bg-closer-error/10 text-closer-error" : "bg-closer-coral/30 text-closer-navy"}`}
                >
                  {level === "critical" ? "Critical" : "Low"}
                </span>
                <span className="text-sm font-extrabold">
                  {lane.eligibleQuestions} eligible Questions
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-closer-muted bg-closer-cream mt-2 rounded-xl px-4 py-5 text-center text-sm">
          No {title.toLowerCase()} inventory lanes.
        </p>
      )}
    </section>
  );
}

export function AdminOverviewWorkspace({ data }: { data: AdminOverview }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section
        aria-labelledby="inventory-heading"
        className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
      >
        <div>
          <h2 className="font-extrabold" id="inventory-heading">
            Inventory lanes needing attention
          </h2>
          <p className="text-closer-muted mt-1 text-xs">Category × relationship × mode</p>
        </div>
        <InventoryLaneList level="critical" lanes={data.criticalInventoryLanes} title="Critical" />
        <InventoryLaneList level="low" lanes={data.lowInventoryLanes} title="Low" />
      </section>

      <section
        aria-labelledby="withdrawn-heading"
        className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-extrabold" id="withdrawn-heading">
            Questions with withdrawn current revisions
          </h2>
          {data.withdrawnQuestionsTotal > data.withdrawnQuestions.length ? (
            <Link
              className="text-closer-navy rounded-md text-xs font-bold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
              href={"/admin/questions?revisionHealth=withdrawn" as Route}
            >
              View all
            </Link>
          ) : null}
        </div>
        {data.withdrawnQuestions.length ? (
          <ul className="divide-closer-navy/10 mt-4 divide-y">
            {data.withdrawnQuestions.map((item) => (
              <li className="py-3" key={item.questionId}>
                <Link
                  className="text-closer-navy line-clamp-2 text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  href={`/admin/questions/${item.questionId}` as Route}
                >
                  {item.text}
                </Link>
                <p className="text-closer-muted mt-1 text-xs">
                  <span>
                    Category: <CategoryValue category={item.category} />
                  </span>{" "}
                  · Current revision v{item.revisionNumber} withdrawn
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-closer-muted bg-closer-cream mt-5 rounded-xl px-4 py-6 text-center text-sm">
            No Questions have a withdrawn current revision.
          </p>
        )}
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
        {data.recentEditorialActivity.length ? (
          <div
            aria-label="Recent editorial activity table"
            className="mt-4 overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-closer-cream/80 text-closer-muted text-xs">
                <tr>
                  <th className="px-4 py-3 font-bold" scope="col">
                    Activity
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    Question
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    Admin
                  </th>
                  <th className="px-4 py-3 font-bold" scope="col">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-closer-navy/8 divide-y">
                {data.recentEditorialActivity.map((item) => (
                  <tr key={item.eventId}>
                    <th className="px-4 py-3 text-left font-bold" scope="row">
                      {actionLabel(item.action)} · v{item.revisionNumber}
                    </th>
                    <td className="max-w-[440px] px-3 py-3">
                      <Link
                        className="text-closer-navy line-clamp-2 font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        href={`/admin/questions/${item.questionId}` as Route}
                      >
                        {item.questionText}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-xs">{item.actorLabel}</td>
                    <td className="text-closer-muted px-4 py-3 text-xs whitespace-nowrap">
                      {formatDate(item.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-closer-muted bg-closer-cream mt-5 rounded-xl px-4 py-6 text-center text-sm">
            No recent question and revision changes.
          </p>
        )}
      </section>
    </div>
  );
}
