import Link from "next/link";
import type { Route } from "next";

import type { AdminQuestionView } from "./admin-workspace-tabs";

type QuestionFilters = {
  search?: string;
  category?: string;
  intensity?: string;
  relationshipFit?: string;
  modeFit?: string;
  activity?: string;
  revisionHealth?: string;
};

export function AdminQuestionFilters({
  filters,
  revisionScope,
  view,
}: {
  filters: QuestionFilters;
  revisionScope: "current" | "all";
  view: AdminQuestionView;
}) {
  return (
    <form
      action="/admin/questions"
      className="rounded-closer-panel shadow-closer-soft mb-5 min-w-0 bg-white/85 p-4"
      method="get"
    >
      <input name="view" type="hidden" value={view} />
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
        {view === "operations" ? (
          <>
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
          </>
        ) : (
          <FilterSelect
            label="Analytics scope"
            name="revisionScope"
            value={revisionScope}
            includeAll={false}
            options={[
              ["current", "Current revision"],
              ["all", "All revisions — historical aggregate"],
            ]}
          />
        )}
        <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
          <button
            className="bg-closer-navy focus-visible:ring-closer-coral min-h-10 rounded-xl px-4 text-sm font-bold text-white focus-visible:ring-2 focus-visible:outline-none"
            type="submit"
          >
            Apply filters
          </button>
          <Link
            className="text-closer-navy focus-visible:ring-closer-navy min-h-10 rounded-xl px-3 py-2.5 text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            href={`/admin/questions?view=${view}` as Route}
          >
            Clear
          </Link>
        </div>
      </div>
    </form>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
  includeAll = true,
}: {
  label: string;
  name: string;
  value?: string;
  options: Array<[string, string]>;
  includeAll?: boolean;
}) {
  return (
    <label className="text-closer-muted flex min-w-0 flex-col gap-1.5 text-xs font-bold">
      {label}
      <select
        className="border-closer-navy/15 bg-closer-cream text-closer-navy focus-visible:ring-closer-navy min-h-10 rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-2"
        defaultValue={value ?? ""}
        name={name}
      >
        {includeAll ? <option value="">All</option> : null}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
