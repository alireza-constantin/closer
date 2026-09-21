import Link from "next/link";
import type { Route } from "next";

import type { getAdminQuestionDetail } from "@/server/modules/admin-questions/admin-question.service";

import {
  CategoryValue,
  FacetCard,
  IntensityValue,
  RevisionHealthBadge,
  ActivityBadge,
  AdminSectionHeading,
} from "./admin-facets";
import { QuestionActivityControl, RevisionActions } from "./admin-question-mutations";

type Revision = {
  revisionId: string;
  revisionNumber: number;
  text: string;
  category: "fun" | "deep" | "memories" | "relationship" | "friendship";
  relationshipFit: "both" | "partner" | "friend";
  modeFit: "both" | "together" | "private";
  intensity: "light" | "medium" | "deep";
  createdAt: string;
  withdrawnAt: string | null;
  actorLabel: string;
  isCurrent: boolean;
};

type Detail = NonNullable<Awaited<ReturnType<typeof getAdminQuestionDetail>>>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function actionLabel(action: string) {
  return (
    (
      {
        activated: "Question activated",
        reactivated: "Question reactivated",
        deactivated: "Question deactivated",
        revision_withdrawn: "Revision withdrawn",
      } as Record<string, string>
    )[action] ?? action
  );
}

export function AdminQuestionDetail({
  detail,
  revisions,
  view,
  page,
  total,
}: {
  detail: Detail;
  revisions: Revision[];
  view: "overview" | "history" | "analytics";
  page: number;
  total: number;
}) {
  const active = detail.activity === "active";
  const latestAction = detail.recentEditorialActivity[0]?.action;
  const reactivation = !active && latestAction === "deactivated";
  const newRevisionHref = `/admin/questions/new?questionId=${detail.questionId}` as Route;
  const pageCount = Math.max(1, Math.ceil(total / 100));

  return (
    <>
      <Link
        className="text-closer-navy mb-5 inline-flex min-h-9 items-center rounded-md text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2"
        href={"/admin/questions" as Route}
      >
        ← Back to questions
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-closer-muted text-xs font-bold">
            Question · {detail.questionId.slice(0, 8)}
          </p>
          <h1 className="mt-1 text-2xl leading-tight font-extrabold tracking-[-.04em] md:text-3xl">
            {detail.currentRevision.text}
          </h1>
          <p className="text-closer-muted mt-2 text-sm">
            Current revision v{detail.currentRevision.revisionNumber}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityBadge active={active} />
          <RevisionHealthBadge withdrawn={detail.revisionHealth === "withdrawn"} />
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <QuestionActivityControl
            blocked={detail.blockedFromActivation}
            isActive={active}
            questionId={detail.questionId}
            reactivation={reactivation}
          />
          <Link
            className="bg-closer-coral focus-visible:ring-closer-navy inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-extrabold shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            href={newRevisionHref}
          >
            + New revision
          </Link>
        </div>
        {detail.blockedFromActivation ? (
          <p className="text-closer-error w-full text-sm font-semibold" role="status">
            This inactive question cannot be activated while its current revision is withdrawn.
            Create a safe new revision first.
          </p>
        ) : null}
      </div>

      <nav
        aria-label="Question detail views"
        className="mb-5 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-white/70 p-1.5 shadow-sm"
      >
        {(
          [
            ["overview", "Overview"],
            ["history", "Revision History"],
            ["analytics", "Analytics"],
          ] as const
        ).map(([id, label]) => (
          <Link
            aria-current={view === id ? "page" : undefined}
            className={`focus-visible:ring-closer-navy rounded-xl px-4 py-2.5 text-sm font-extrabold focus-visible:ring-2 focus-visible:outline-none ${view === id ? "bg-closer-coral" : "text-closer-navy/70 hover:bg-closer-cream"}`}
            href={`/admin/questions/${detail.questionId}?view=${id}` as Route}
            key={id}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
          <section className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6">
            <h2 className="font-extrabold">Current wording</h2>
            <blockquote className="border-closer-coral mt-4 border-l-4 pl-4 text-lg leading-relaxed">
              {detail.currentRevision.text}
            </blockquote>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <FacetCard label="Category">
                <CategoryValue category={detail.currentRevision.category} />
              </FacetCard>
              <FacetCard label="Intensity">
                <span>
                  Intensity: <IntensityValue intensity={detail.currentRevision.intensity} />
                </span>
              </FacetCard>
              <FacetCard label="Relationship fit">
                {detail.currentRevision.relationshipFit === "both"
                  ? "Both"
                  : detail.currentRevision.relationshipFit === "partner"
                    ? "Partner"
                    : "Friend"}
              </FacetCard>
              <FacetCard label="Mode fit">
                {detail.currentRevision.modeFit === "both"
                  ? "Both"
                  : detail.currentRevision.modeFit === "private"
                    ? "Private"
                    : "Together"}
              </FacetCard>
            </div>
          </section>
          <section className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6">
            <h2 className="font-extrabold">Recent editorial activity</h2>
            {detail.recentEditorialActivity.length ? (
              <ol className="mt-4 flex flex-col gap-3">
                {detail.recentEditorialActivity.slice(0, 8).map((event) => (
                  <li
                    className="border-closer-navy/10 flex items-start justify-between gap-3 border-b pb-3 last:border-0"
                    key={event.eventId}
                  >
                    <div>
                      <p className="text-sm font-bold">{actionLabel(event.action)}</p>
                      <p className="text-closer-muted mt-1 text-xs">
                        {event.actorLabel}
                        {event.reason ? ` · ${event.reason}` : ""}
                      </p>
                    </div>
                    <time
                      className="text-closer-muted shrink-0 text-xs"
                      dateTime={event.occurredAt}
                    >
                      {formatDate(event.occurredAt)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-closer-muted bg-closer-cream mt-4 rounded-xl p-4 text-sm">
                No Admin lifecycle activity is recorded for this question.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {view === "history" ? (
        <section
          aria-labelledby="history-heading"
          className="rounded-closer-panel shadow-closer-soft overflow-hidden bg-white/90"
        >
          <div className="px-4 py-4 md:px-5">
            <h2 className="font-extrabold" id="history-heading">
              Revision history
            </h2>
            <p className="text-closer-muted mt-1 text-xs">
              Immutable revisions, newest first. Withdrawal is available for any safe revision.
            </p>
          </div>
          <div
            aria-label="Question revision history table"
            className="overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
            role="region"
            tabIndex={0}
          >
            <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
              <thead className="bg-closer-cream/80 text-closer-muted text-xs">
                <tr>
                  <th className="px-4 py-3 font-bold" scope="col">
                    Revision
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    Wording and metadata
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    Created
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    By
                  </th>
                  <th className="px-3 py-3 font-bold" scope="col">
                    Revision health
                  </th>
                  <th className="px-4 py-3 font-bold" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-closer-navy/8 divide-y">
                {revisions.map((revision) => (
                  <tr className="align-top" key={revision.revisionId}>
                    <th
                      className="px-4 py-4 text-left font-extrabold whitespace-nowrap"
                      scope="row"
                    >
                      v{revision.revisionNumber}
                      {revision.isCurrent ? (
                        <span className="text-closer-coral ml-2 text-[10px] uppercase">
                          Current
                        </span>
                      ) : null}
                    </th>
                    <td className="max-w-[480px] px-3 py-4">
                      <p className="leading-relaxed font-semibold">{revision.text}</p>
                      <p className="text-closer-muted mt-2 text-xs">
                        <span>
                          Category:{" "}
                          {revision.category === "deep"
                            ? "Deep"
                            : revision.category[0]?.toUpperCase() + revision.category.slice(1)}
                        </span>{" "}
                        ·{" "}
                        <span>
                          Intensity:{" "}
                          {revision.intensity[0]?.toUpperCase() + revision.intensity.slice(1)}
                        </span>{" "}
                        ·{" "}
                        {revision.relationshipFit === "both"
                          ? "Both relationships"
                          : revision.relationshipFit}{" "}
                        · {revision.modeFit === "both" ? "Both modes" : revision.modeFit}
                      </p>
                    </td>
                    <td className="text-closer-muted px-3 py-4 text-xs whitespace-nowrap">
                      {formatDate(revision.createdAt)}
                    </td>
                    <td className="px-3 py-4 text-xs">{revision.actorLabel}</td>
                    <td className="px-3 py-4 text-xs font-bold">
                      {revision.isCurrent
                        ? revision.withdrawnAt
                          ? "Current revision withdrawn"
                          : "Current · Safe"
                        : revision.withdrawnAt
                          ? "Withdrawn"
                          : "Safe historical revision"}
                    </td>
                    <td className="px-4 py-4">
                      <RevisionActions
                        currentRevisionId={detail.currentRevisionId}
                        questionId={detail.questionId}
                        revision={revision}
                      />
                    </td>
                  </tr>
                ))}
                {revisions.length === 0 ? (
                  <tr>
                    <td className="text-closer-muted px-5 py-10 text-center" colSpan={6}>
                      No revisions are available.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <div className="border-closer-navy/10 flex items-center justify-between border-t px-5 py-3">
              <span className="text-closer-muted text-xs">
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-3">
                {page <= 1 ? (
                  <span aria-disabled="true" className="text-closer-muted text-sm font-bold">
                    Previous
                  </span>
                ) : (
                  <Link
                    className="text-sm font-bold underline focus-visible:ring-2"
                    href={
                      `/admin/questions/${detail.questionId}?view=history&page=${page - 1}` as Route
                    }
                  >
                    Previous
                  </Link>
                )}
                {page >= pageCount ? (
                  <span aria-disabled="true" className="text-closer-muted text-sm font-bold">
                    Next
                  </span>
                ) : (
                  <Link
                    className="text-sm font-bold underline focus-visible:ring-2"
                    href={
                      `/admin/questions/${detail.questionId}?view=history&page=${page + 1}` as Route
                    }
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {view === "analytics" ? (
        <section
          aria-labelledby="detail-analytics-heading"
          className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
        >
          <h2 className="font-extrabold" id="detail-analytics-heading">
            Question analytics
          </h2>
          <p className="text-closer-muted mt-1 text-sm">All time · Current revision</p>
          <p className="text-closer-muted bg-closer-cream mt-6 rounded-xl px-4 py-8 text-center text-sm">
            Analytics values will appear here when the protected projections are connected. No
            metric values are shown yet.
          </p>
        </section>
      ) : null}
    </>
  );
}
