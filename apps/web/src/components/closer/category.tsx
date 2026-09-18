import { ChevronRight } from "lucide-react";

import { cn } from "@Closer/ui/lib/utils";

export type CloserCategory = "fun" | "deep" | "memories" | "relationship" | "friendship";
export type CloserRelationship = "partner" | "friend";
export type CloserMode = "private" | "together";

const categorySurfaceClasses: Record<CloserCategory, string> = {
  fun: "bg-closer-yellow",
  deep: "bg-closer-blue",
  memories: "bg-closer-mint",
  relationship: "bg-closer-coral-soft",
  friendship: "bg-closer-friendship",
};

const categoryMeta: Record<
  CloserCategory,
  { label: string; descriptions: Record<CloserMode, string> }
> = {
  fun: {
    label: "Fun",
    descriptions: {
      private: "A little lighter, a little playful",
      together: "Lighter questions for brighter days",
    },
  },
  deep: {
    label: "Deep",
    descriptions: {
      private: "Thoughtful questions worth lingering on",
      together: "Bigger questions for a closer you",
    },
  },
  memories: {
    label: "Memories",
    descriptions: { private: "Moments you’ve shared", together: "Look back, together" },
  },
  relationship: {
    label: "Relationship",
    descriptions: { private: "For the two of you", together: "About your journey together" },
  },
  friendship: {
    label: "Friendship",
    descriptions: { private: "For the way you show up", together: "The good stuff you share" },
  },
};

const categoriesByRelationship = {
  partner: ["fun", "deep", "memories", "relationship"],
  friend: ["fun", "deep", "memories", "friendship"],
} as const satisfies Record<CloserRelationship, readonly CloserCategory[]>;

export function categoryLabel(category: CloserCategory) {
  return categoryMeta[category].label;
}

export function categoryDescription(category: CloserCategory, mode: CloserMode) {
  return categoryMeta[category].descriptions[mode];
}

export function categorySurfaceClass(category: CloserCategory) {
  return categorySurfaceClasses[category];
}

export function categoriesForRelationship(
  relationship: CloserRelationship,
): readonly CloserCategory[] {
  return categoriesByRelationship[relationship];
}

export function CategoryBadge({ category }: { category: CloserCategory }) {
  return (
    <span
      className={cn(
        "text-closer-navy inline-flex w-fit items-center justify-center rounded-full px-3.5 py-2 text-[.87rem] font-extrabold capitalize",
        categorySurfaceClass(category),
      )}
    >
      {categoryLabel(category)}
    </span>
  );
}

export function CategoryCard({
  category,
  compact = false,
  disabled,
  mode,
  pending,
  onClick,
}: {
  category: CloserCategory;
  compact?: boolean;
  disabled?: boolean;
  mode: CloserMode;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "group text-closer-navy shadow-closer-soft focus-visible:ring-closer-navy focus-visible:ring-offset-closer-cream grid w-full grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[1.3rem] px-[18px] text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60",
        compact ? "min-h-[70px] py-3" : "min-h-[78px] py-4",
        categorySurfaceClass(category),
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="text-[1.05rem] font-extrabold">{categoryLabel(category)}</span>
      <small className="text-closer-navy/75 col-start-1 text-xs leading-relaxed">
        {categoryDescription(category, mode)}
      </small>
      <ChevronRight
        aria-hidden="true"
        className="col-start-2 row-span-2 row-start-1 size-5 transition-transform duration-200 group-hover:translate-x-0.5"
      />
      {pending ? (
        <em className="text-closer-navy/70 col-start-1 text-xs font-bold not-italic">Opening…</em>
      ) : null}
    </button>
  );
}
