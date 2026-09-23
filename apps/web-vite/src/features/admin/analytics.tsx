import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { adminCategoryLabel, adminCategoryTone } from "@/features/admin/category-presentation";
import type { Question, Revision } from "@/features/admin/api";
import {
  adminCoverageKey,
  adminQuestionAnalyticsKey,
  getAdminCoverage,
  getAdminQuestionAnalytics,
  type AnalyticsRate,
  type AnalyticsSelection,
  type CoverageItem,
  type QuestionAnalytics,
} from "@/features/admin/analytics-api";
import { ApiError } from "@/lib/api-client";

export function invalidateQuestionAnalytics(queryClient: QueryClient, questionId: string) {
  return queryClient.invalidateQueries({
    queryKey: ["admin", "analytics", "question", questionId],
  });
}

export function invalidateCoverage(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: adminCoverageKey });
}

export function AdminCoverageOverview() {
  const coverage = useQuery({ queryKey: adminCoverageKey, queryFn: getAdminCoverage });
  return (
    <section aria-labelledby="coverage-heading" className="space-y-4">
      <div className="max-w-3xl">
        <p className="text-closer-coral text-xs font-extrabold tracking-[.12em] uppercase">
          Inventory
        </p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-[-.04em]" id="coverage-heading">
          Question coverage
        </h2>
        <p className="text-closer-muted mt-2 text-sm leading-6">
          Enough usable, active Questions for each category, relationship, and mode lane. Coverage
          describes inventory availability, not Question or relationship quality.
        </p>
      </div>
      {coverage.isPending ? (
        <AnalyticsLoadingState>Loading Question coverage…</AnalyticsLoadingState>
      ) : coverage.error ? (
        <AnalyticsErrorState error={coverage.error} />
      ) : coverage.data.items.length === 0 ? (
        <AnalyticsLoadingState>No coverage lanes are available.</AnalyticsLoadingState>
      ) : (
        <CoverageGrid items={coverage.data.items} />
      )}
    </section>
  );
}

export function QuestionAnalyticsPanel({
  question,
  revisions,
}: {
  question: Question;
  revisions: Revision[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("analyticsRevision");
  const selectedRevision = revisions.find((revision) => revision.id === requested);
  const selection: AnalyticsSelection =
    requested === "all"
      ? { revisionScope: "all" }
      : selectedRevision
        ? { revisionScope: "revision", revisionId: selectedRevision.id }
        : { revisionScope: "current" };
  const analytics = useQuery({
    queryKey: adminQuestionAnalyticsKey(question.id, selection),
    queryFn: () => getAdminQuestionAnalytics(question.id, selection),
  });

  function updateScope(value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "current") next.delete("analyticsRevision");
      else next.set("analyticsRevision", value);
      return next;
    });
  }

  const revisionLabel = analytics.data
    ? analyticsScopeLabel(analytics.data, question.current)
    : selection.revisionScope === "all"
      ? "All revisions — historical aggregate"
      : selection.revisionScope === "revision"
        ? `Revision v${selectedRevision?.revisionNumber} — historical`
        : `Current revision v${question.current.revisionNumber}`;

  return (
    <section aria-labelledby="question-analytics-heading" className="space-y-5">
      <div className="bg-closer-surface border-closer-line rounded-3xl border p-5 sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-closer-coral text-xs font-extrabold tracking-[.12em] uppercase">
              All time
            </p>
            <h3 className="mt-1 text-xl font-extrabold" id="question-analytics-heading">
              Question analytics
            </h3>
            <p className="text-closer-muted mt-1 text-sm">{revisionLabel}</p>
          </div>
          <label className="text-closer-muted flex w-full flex-col gap-1.5 text-xs font-bold lg:w-auto">
            Revision scope
            <select
              aria-label="Analytics revision scope"
              className="border-closer-line bg-closer-cream text-closer-navy focus-visible:ring-closer-coral min-h-11 rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-2"
              onChange={(event) => updateScope(event.currentTarget.value)}
              value={
                selection.revisionScope === "all"
                  ? "all"
                  : selection.revisionScope === "revision"
                    ? selection.revisionId
                    : "current"
              }
            >
              <option value="current">Current revision (v{question.current.revisionNumber})</option>
              {revisions
                .filter((revision) => revision.id !== question.currentRevisionId)
                .map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    Revision v{revision.revisionNumber} — historical
                  </option>
                ))}
              <option value="all">All revisions — historical aggregate</option>
            </select>
          </label>
        </div>
        {analytics.isPending ? (
          <AnalyticsLoadingState>Loading Question analytics…</AnalyticsLoadingState>
        ) : analytics.error ? (
          <AnalyticsErrorState error={analytics.error} />
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <AnalyticsMetricGroup title="Private" value={analytics.data.private} />
            <AnalyticsMetricGroup title="Together" value={analytics.data.together} />
          </div>
        )}
      </div>
    </section>
  );
}

export function CoverageGrid({ items }: { items: CoverageItem[] }) {
  return (
    <ul
      className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Question coverage lanes"
    >
      {items.map((item) => (
        <li
          className={`border-closer-line bg-closer-surface min-w-0 rounded-2xl border p-4 shadow-[0_8px_24px_rgba(16,37,101,.04)] ${adminCategoryTone[item.category]}`}
          key={`${item.category}:${item.relationshipType}:${item.mode}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-extrabold">{adminCategoryLabel(item.category)}</h3>
            <CoverageHealth health={item.health} />
          </div>
          <p className="text-closer-muted mt-1 text-xs capitalize">
            {item.relationshipType} · {item.mode}
          </p>
          <p className="mt-4 text-3xl font-extrabold tabular-nums">{item.eligible}</p>
          <p className="text-closer-muted text-xs">usable Questions</p>
          <p className="text-closer-muted border-closer-navy/10 mt-3 border-t pt-2 text-xs">
            Intensity mix · Light {item.intensity.light} · Medium {item.intensity.medium} · Deep{" "}
            {item.intensity.deep}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsMetricGroup({
  title,
  value,
}: {
  title: string;
  value: QuestionAnalytics["private"] | QuestionAnalytics["together"];
}) {
  if (value.status === "insufficient_data") {
    return (
      <section aria-label={`${title} metrics`} className="bg-closer-cream rounded-2xl p-4 sm:p-5">
        <h4 className="font-extrabold">{title}</h4>
        <p
          className="text-closer-muted mt-3 rounded-xl bg-white/80 px-4 py-5 text-sm"
          role="status"
        >
          Insufficient data
        </p>
      </section>
    );
  }

  const metrics =
    "validOffers" in value
      ? [
          ["Valid offers", formatCount(value.validOffers)],
          ["Decisions", formatCount(value.decisions)],
          ["Decision rate", formatRate(value.decisionRate)],
          ["Ask rate", formatRate(value.askRate)],
          ["Skip rate", formatRate(value.skipRate)],
          ["Like rate", formatRate(value.likeRate)],
        ]
      : [
          ["Shown", formatCount(value.shown)],
          ["Decisions", formatCount(value.decisions)],
          ["Continue rate", formatRate(value.continueRate)],
          ["Skip rate", formatRate(value.skipRate)],
          ["Like rate", formatRate(value.likeRate)],
        ];
  return (
    <section aria-label={`${title} metrics`} className="bg-closer-cream rounded-2xl p-4 sm:p-5">
      <h4 className="font-extrabold">{title}</h4>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, display]) => (
          <div className="min-w-0 rounded-xl bg-white/80 p-3" key={label}>
            <dt className="text-closer-muted text-xs">{label}</dt>
            <dd className="mt-1 text-sm font-extrabold break-words tabular-nums">{display}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CoverageHealth({ health }: { health: CoverageItem["health"] }) {
  const styles = {
    critical: "bg-closer-coral/20 text-closer-navy",
    low: "bg-closer-yellow/50 text-closer-navy",
    healthy: "bg-closer-mint/50 text-closer-navy",
  } as const;
  const label = health === "critical" ? "Critical" : health === "low" ? "Low" : "Healthy";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${styles[health]}`}>
      {label}
    </span>
  );
}

function AnalyticsMessage({
  children,
  role,
  tone,
}: {
  children: React.ReactNode;
  role: "status" | "alert";
  tone: "muted" | "error";
}) {
  return (
    <p
      className={`mt-4 rounded-xl bg-white/80 px-4 py-5 text-sm ${tone === "error" ? "text-closer-error" : "text-closer-muted"}`}
      role={role}
    >
      {children}
    </p>
  );
}

export function AnalyticsLoadingState({ children }: { children: React.ReactNode }) {
  return (
    <AnalyticsMessage role="status" tone="muted">
      {children}
    </AnalyticsMessage>
  );
}

export function AnalyticsErrorState({ error }: { error: unknown }) {
  return (
    <AnalyticsMessage role="alert" tone="error">
      {analyticsErrorMessage(error)}
    </AnalyticsMessage>
  );
}

function analyticsScopeLabel(data: QuestionAnalytics, current: Revision) {
  if (data.revisionScope === "all") return "All revisions — historical aggregate";
  if (data.revisionScope === "revision")
    return `Revision v${data.selectedRevisionNumber} — historical`;
  return `Current revision v${data.selectedRevisionNumber ?? current.revisionNumber}`;
}

function analyticsErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "UNAUTHENTICATED")
    return "Admin sign-in is required to view analytics.";
  if (error instanceof ApiError && error.code === "FORBIDDEN")
    return "Admin access is required to view analytics.";
  return "Analytics could not be loaded. Try again in a moment.";
}

function formatRate(value: AnalyticsRate) {
  if (value.status === "unavailable") return "Unavailable";
  const rate = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(
    value.rate,
  );
  return `${rate} · ${formatCount(value.numerator)} / ${formatCount(value.denominator)}`;
}

function formatCount(value: number) {
  return value.toLocaleString("en");
}
