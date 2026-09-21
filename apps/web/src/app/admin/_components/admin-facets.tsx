import type { ReactNode } from "react";

import {
  categoryLabel,
  categorySurfaceClass,
  type CloserCategory,
} from "@/components/closer/category";

export function ActivityBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${active ? "bg-closer-mint text-closer-navy" : "bg-closer-cream text-closer-navy/75"}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${active ? "bg-emerald-700" : "bg-closer-navy/35"}`}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function RevisionHealthBadge({ withdrawn }: { withdrawn: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${withdrawn ? "bg-closer-coral-soft text-closer-navy" : "bg-closer-blue text-closer-navy"}`}
    >
      <span aria-hidden="true">{withdrawn ? "!" : "✓"}</span>
      {withdrawn ? "Current revision withdrawn" : "Safe"}
    </span>
  );
}

export function CategoryValue({ category }: { category: CloserCategory }) {
  return (
    <span
      aria-label={`Category: ${categoryLabel(category)}`}
      className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-extrabold ${categorySurfaceClass(category)}`}
    >
      {categoryLabel(category)}
    </span>
  );
}

export function IntensityValue({ intensity }: { intensity: "light" | "medium" | "deep" }) {
  return (
    <span className="text-closer-navy/80 text-xs font-bold">
      {intensity[0]?.toUpperCase()}
      {intensity.slice(1)}
    </span>
  );
}

export function FacetCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-closer-panel shadow-closer-soft min-w-0 bg-white/85 px-4 py-3">
      <p className="text-closer-muted text-xs font-bold">{label}</p>
      <div className="mt-2 text-sm font-extrabold">{children}</div>
    </div>
  );
}

export function AdminSectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-closer-coral text-xs font-extrabold tracking-[.12em] uppercase">
          Closer Admin
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-[-.04em] md:text-[1.85rem]">
          {title}
        </h1>
        <p className="text-closer-muted mt-1 max-w-3xl text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
