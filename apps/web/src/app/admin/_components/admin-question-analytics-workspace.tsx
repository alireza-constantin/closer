import Link from "next/link";
import type { Route } from "next";

import type {
  AdminPrivateQuestionAnalyticsItem,
  AdminTogetherQuestionAnalyticsItem,
} from "@/contracts/admin/question.schema";
import type { listAdminQuestions } from "@/server/modules/admin-questions/admin-question.service";

import { CategoryValue, IntensityValue } from "./admin-facets";

type AdminQuestionList = Awaited<ReturnType<typeof listAdminQuestions>>;

function formatCount(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en");
}

function formatRate(value: number | null) {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function QuestionLink({ questionId, text }: { questionId: string; text: string }) {
  return (
    <Link
      className="text-closer-navy focus-visible:ring-closer-navy line-clamp-2 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      href={`/admin/questions/${questionId}` as Route}
    >
      {text}
    </Link>
  );
}

function CurrentQuestionFacets({
  item,
  revisionScope,
}: {
  item: AdminQuestionList["items"][number];
  revisionScope: "current" | "all";
}) {
  const prefix = revisionScope === "all" ? "Current " : "";
  return (
    <>
      <td className="px-3 py-3">
        <CategoryValue category={item.currentRevision.category} />
      </td>
      <td className="px-3 py-3">
        <span className="sr-only">{prefix}intensity: </span>
        <IntensityValue intensity={item.currentRevision.intensity} />
      </td>
      <td className="px-3 py-3 text-xs font-semibold">
        {item.currentRevision.relationshipFit === "both"
          ? "Both"
          : item.currentRevision.relationshipFit}
      </td>
      <td className="px-3 py-3 text-xs font-semibold">
        {item.currentRevision.modeFit === "both" ? "Both" : item.currentRevision.modeFit}
      </td>
    </>
  );
}

export function PrivateAnalyticsTable({
  data,
  metrics,
  revisionScope,
}: {
  data: AdminQuestionList;
  metrics: AdminPrivateQuestionAnalyticsItem[];
  revisionScope: "current" | "all";
}) {
  const byQuestion = new Map(metrics.map((item) => [item.questionId, item]));
  return (
    <AnalyticsTableFrame
      description={
        revisionScope === "all"
          ? "All revisions — historical aggregate. Row wording and fit labels show the current revision."
          : "Current revision · All time"
      }
      title="Private question analytics"
    >
      <table className="w-full min-w-[1420px] border-collapse text-left text-sm">
        <thead className="bg-closer-cream/80 text-closer-muted text-xs">
          <tr>
            <th className="px-4 py-3 font-bold" scope="col">
              Question
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current category" : "Category"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current intensity" : "Intensity"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current relationship fit" : "Relationship fit"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current mode fit" : "Mode fit"}
            </th>
            {[
              "Valid Offers",
              "Decisions",
              "Decision Rate",
              "Ask Rate",
              "Skip Rate",
              "Like Rate",
            ].map((label) => (
              <th className="px-3 py-3 font-bold" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-closer-navy/8 divide-y">
          {data.items.map((item) => {
            const metric = byQuestion.get(item.questionId);
            return (
              <tr className="hover:bg-closer-cream/50" key={item.questionId}>
                <th className="max-w-[270px] px-4 py-3 text-left font-semibold" scope="row">
                  <QuestionLink questionId={item.questionId} text={item.currentRevision.text} />
                </th>
                <CurrentQuestionFacets item={item} revisionScope={revisionScope} />
                {metric?.status === "insufficient_data" ? (
                  <td
                    className="text-closer-muted px-3 py-3 text-xs font-bold"
                    colSpan={6}
                    role="status"
                  >
                    Insufficient data
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-3 text-xs">
                      {formatCount(metric?.validOffers ?? null)}
                    </td>
                    <td className="px-3 py-3 text-xs">{formatCount(metric?.decisions ?? null)}</td>
                    <td className="px-3 py-3 text-xs">
                      {formatRate(metric?.decisionRate ?? null)}
                    </td>
                    <td className="px-3 py-3 text-xs">{formatRate(metric?.askRate ?? null)}</td>
                    <td className="px-3 py-3 text-xs">{formatRate(metric?.skipRate ?? null)}</td>
                    <td className="px-3 py-3 text-xs">{formatRate(metric?.likeRate ?? null)}</td>
                  </>
                )}
              </tr>
            );
          })}
          {data.items.length === 0 ? (
            <tr>
              <td className="text-closer-muted px-5 py-12 text-center" colSpan={11}>
                No questions match these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </AnalyticsTableFrame>
  );
}

export function TogetherAnalyticsTable({
  data,
  metrics,
  revisionScope,
}: {
  data: AdminQuestionList;
  metrics: AdminTogetherQuestionAnalyticsItem[];
  revisionScope: "current" | "all";
}) {
  const byQuestion = new Map(metrics.map((item) => [item.questionId, item]));
  return (
    <AnalyticsTableFrame
      description={
        revisionScope === "all"
          ? "All revisions — historical aggregate. Row wording and fit labels show the current revision."
          : "Current revision · All time"
      }
      title="Together question analytics"
    >
      <table className="w-full min-w-[1300px] border-collapse text-left text-sm">
        <thead className="bg-closer-cream/80 text-closer-muted text-xs">
          <tr>
            <th className="px-4 py-3 font-bold" scope="col">
              Question
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current category" : "Category"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current intensity" : "Intensity"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current relationship fit" : "Relationship fit"}
            </th>
            <th className="px-3 py-3 font-bold" scope="col">
              {revisionScope === "all" ? "Current mode fit" : "Mode fit"}
            </th>
            {["Shown", "Decisions", "Continue Rate", "Skip Rate", "Like Rate"].map((label) => (
              <th className="px-3 py-3 font-bold" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-closer-navy/8 divide-y">
          {data.items.map((item) => {
            const metric = byQuestion.get(item.questionId);
            return (
              <tr className="hover:bg-closer-cream/50" key={item.questionId}>
                <th className="max-w-[270px] px-4 py-3 text-left font-semibold" scope="row">
                  <QuestionLink questionId={item.questionId} text={item.currentRevision.text} />
                </th>
                <CurrentQuestionFacets item={item} revisionScope={revisionScope} />
                {metric?.status === "insufficient_data" ? (
                  <td
                    className="text-closer-muted px-3 py-3 text-xs font-bold"
                    colSpan={5}
                    role="status"
                  >
                    Insufficient data
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-3 text-xs">{formatCount(metric?.shown ?? null)}</td>
                    <td className="px-3 py-3 text-xs">{formatCount(metric?.decisions ?? null)}</td>
                    <td className="px-3 py-3 text-xs">
                      {formatRate(metric?.continueRate ?? null)}
                    </td>
                    <td className="px-3 py-3 text-xs">{formatRate(metric?.skipRate ?? null)}</td>
                    <td className="px-3 py-3 text-xs">{formatRate(metric?.likeRate ?? null)}</td>
                  </>
                )}
              </tr>
            );
          })}
          {data.items.length === 0 ? (
            <tr>
              <td className="text-closer-muted px-5 py-12 text-center" colSpan={10}>
                No questions match these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </AnalyticsTableFrame>
  );
}

function AnalyticsTableFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-closer-panel shadow-closer-soft overflow-hidden bg-white/90"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-4 md:px-5">
        <div>
          <h2 className="text-lg font-extrabold">{title}</h2>
          <p className="text-closer-muted mt-1 text-sm">{description}</p>
        </div>
        <p className="text-closer-muted text-xs">Question-level aggregates only</p>
      </div>
      <div
        aria-label={`${title} table`}
        className="overflow-x-auto focus-visible:ring-2 focus-visible:outline-none"
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
