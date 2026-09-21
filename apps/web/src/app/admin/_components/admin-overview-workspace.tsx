import Link from "next/link";
import type { Route } from "next";

import type { getAdminOverview } from "@/server/modules/admin-questions/admin-overview.service";

import { CategoryValue } from "./admin-facets";
import { QuestionCoverageSummary } from "./admin-question-coverage";

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

export function AdminOverviewWorkspace({ data }: { data: AdminOverview }) {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <QuestionCoverageSummary
        lanes={[...data.criticalInventoryLanes, ...data.lowInventoryLanes]}
      />

      <section
        aria-labelledby="withdrawn-heading"
        className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
      >
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                  className="text-closer-navy line-clamp-2 text-sm font-bold break-words underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
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
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-extrabold" id="activity-heading">
            Recent editorial activity
          </h2>
          <span className="text-closer-muted text-xs">Admin actions only</span>
        </div>
        {data.recentEditorialActivity.length ? (
          <>
            <div className="mt-4 sm:hidden">
              <ul className="divide-closer-navy/10 divide-y">
                {data.recentEditorialActivity.map((item) => (
                  <li className="py-3" key={item.eventId}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold">
                        {actionLabel(item.action)} · v{item.revisionNumber}
                      </p>
                      <time
                        className="text-closer-muted shrink-0 text-right text-xs"
                        dateTime={item.occurredAt}
                      >
                        {formatDate(item.occurredAt)}
                      </time>
                    </div>
                    <Link
                      className="text-closer-navy mt-1 block text-sm font-semibold break-words underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      href={`/admin/questions/${item.questionId}` as Route}
                    >
                      {item.questionText}
                    </Link>
                    <p className="text-closer-muted mt-1 text-xs break-words">{item.actorLabel}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div
              aria-label="Recent editorial activity table"
              className="mt-4 hidden max-w-full min-w-0 overflow-x-auto focus-visible:ring-2 focus-visible:outline-none sm:block"
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
          </>
        ) : (
          <p className="text-closer-muted bg-closer-cream mt-5 rounded-xl px-4 py-6 text-center text-sm">
            No recent question and revision changes.
          </p>
        )}
      </section>
    </div>
  );
}
