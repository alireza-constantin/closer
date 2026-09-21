import Link from "next/link";
import type { Route } from "next";

import type { getAdminQuestionCoverage } from "@/server/modules/admin-questions/admin-overview.service";

import { CategoryValue } from "./admin-facets";

type QuestionCoverageLane = Awaited<ReturnType<typeof getAdminQuestionCoverage>>[number];

const categoryOrder: Record<QuestionCoverageLane["category"], number> = {
  fun: 0,
  deep: 1,
  memories: 2,
  relationship: 3,
  friendship: 4,
};

const relationshipOrder: Record<QuestionCoverageLane["relationship"], number> = {
  partner: 0,
  friend: 1,
};

const modeOrder: Record<QuestionCoverageLane["mode"], number> = {
  private: 0,
  together: 1,
};

const severityOrder: Record<QuestionCoverageLane["level"], number> = {
  critical: 0,
  low: 1,
  healthy: 2,
};

function compareCoverageLanes(a: QuestionCoverageLane, b: QuestionCoverageLane) {
  return (
    categoryOrder[a.category] - categoryOrder[b.category] ||
    relationshipOrder[a.relationship] - relationshipOrder[b.relationship] ||
    modeOrder[a.mode] - modeOrder[b.mode]
  );
}

export function getMostUrgentQuestionCoverage(lanes: readonly QuestionCoverageLane[]) {
  return lanes
    .filter((lane) => lane.level !== "healthy")
    .sort((a, b) => {
      return (
        severityOrder[a.level] - severityOrder[b.level] ||
        a.eligibleQuestions - b.eligibleQuestions ||
        compareCoverageLanes(a, b)
      );
    })
    .slice(0, 5);
}

function CoverageLaneRow({ lane }: { lane: QuestionCoverageLane }) {
  return (
    <li className="border-closer-navy/10 flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white/75 px-3 py-3">
      <div className="min-w-0">
        <p className="leading-tight font-extrabold">
          <CategoryValue category={lane.category} />
        </p>
        <p className="text-closer-muted mt-1 text-xs font-semibold">
          {lane.relationship === "partner" ? "Partner" : "Friend"} ·{" "}
          {lane.mode === "private" ? "Private" : "Together"}
        </p>
        <p className="text-closer-muted mt-1 text-xs">
          <span className="font-bold">Intensity:</span> Light {lane.intensityBreakdown.light} ·
          Medium {lane.intensityBreakdown.medium} · Deep {lane.intensityBreakdown.deep}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span
          className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${lane.level === "critical" ? "bg-closer-error/10 text-closer-error" : lane.level === "low" ? "bg-closer-coral/30 text-closer-navy" : "bg-closer-mint text-closer-navy"}`}
        >
          {lane.level === "critical" ? "Critical" : lane.level === "low" ? "Low" : "Healthy"}
        </span>
        <span className="text-sm font-extrabold">
          {lane.eligibleQuestions} question{lane.eligibleQuestions === 1 ? "" : "s"} available
        </span>
      </div>
    </li>
  );
}

export function QuestionCoverageSummary({ lanes }: { lanes: readonly QuestionCoverageLane[] }) {
  const urgentLanes = getMostUrgentQuestionCoverage(lanes);

  return (
    <section
      aria-labelledby="coverage-heading"
      className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-extrabold" id="coverage-heading">
            Question coverage
          </h2>
          <p className="text-closer-muted mt-1 text-xs">
            Make sure every conversation type has enough questions.
          </p>
        </div>
        <Link
          className="text-closer-navy rounded-md text-xs font-bold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          href={"/admin/questions?coverage=all" as Route}
        >
          View all coverage
        </Link>
      </div>
      {urgentLanes.length ? (
        <ul aria-label="Most urgent question coverage gaps" className="mt-4 space-y-2">
          {urgentLanes.map((lane) => (
            <CoverageLaneRow
              key={`${lane.category}:${lane.relationship}:${lane.mode}`}
              lane={lane}
            />
          ))}
        </ul>
      ) : (
        <p
          className="text-closer-muted bg-closer-cream mt-5 rounded-xl px-4 py-5 text-center text-sm"
          role="status"
        >
          <span className="text-closer-navy block font-extrabold">Coverage looks healthy</span>
          <span className="mt-1 block">
            Every conversation type currently has enough eligible questions.
          </span>
        </p>
      )}
    </section>
  );
}

export function QuestionCoverageWorkspace({ lanes }: { lanes: readonly QuestionCoverageLane[] }) {
  const orderedLanes = [...lanes].sort(compareCoverageLanes);

  return (
    <section
      aria-labelledby="all-coverage-heading"
      className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
    >
      <div>
        <h2 className="font-extrabold" id="all-coverage-heading">
          All conversation types
        </h2>
        <p className="text-closer-muted mt-1 text-xs">
          Eligible questions across every category, relationship, and mode.
        </p>
      </div>
      {orderedLanes.length ? (
        <ul aria-label="Complete question coverage" className="mt-4 space-y-2">
          {orderedLanes.map((lane) => (
            <CoverageLaneRow
              key={`${lane.category}:${lane.relationship}:${lane.mode}`}
              lane={lane}
            />
          ))}
        </ul>
      ) : (
        <p className="text-closer-muted bg-closer-cream mt-5 rounded-xl px-4 py-5 text-center text-sm">
          No conversation types are available.
        </p>
      )}
    </section>
  );
}
