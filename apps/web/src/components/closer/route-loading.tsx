import { Skeleton } from "@Closer/ui/components/skeleton";
import { cn } from "@Closer/ui/lib/utils";

import {
  categoriesForRelationship,
  categorySurfaceClass,
  type CloserCategory,
} from "@/components/closer/category";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";

type RouteLoadingVariant = "form" | "history" | "home" | "together-question";

const loadingCategories = categoriesForRelationship("partner");

function LoadingLine({ className }: { className: string }) {
  return <Skeleton className={`bg-closer-navy/10 rounded-full ${className}`} />;
}

function LoadingBackButton() {
  return <Skeleton aria-hidden="true" className="size-9 rounded-[.8rem] bg-white/65" />;
}

function LoadingModeBadge({ mode }: { mode: "private" | "together" }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={cn(
        "h-9 rounded-full",
        mode === "private" ? "bg-closer-lavender-soft w-[76px]" : "bg-closer-coral-soft w-[88px]",
      )}
    />
  );
}

function LoadingCategoryCard({
  category,
  compact,
}: {
  category: CloserCategory;
  compact?: boolean;
}) {
  return (
    <Skeleton
      aria-hidden="true"
      className={cn(
        "shadow-closer-soft grid w-full grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[1.3rem] px-[18px] text-left",
        compact ? "min-h-[70px] py-3" : "min-h-[78px] py-4",
        categorySurfaceClass(category),
      )}
    >
      <LoadingLine className="bg-closer-navy/20 h-4 w-20" />
      <LoadingLine className="bg-closer-navy/15 col-start-1 h-3 w-44 max-w-full" />
      <Skeleton className="bg-closer-navy/15 col-start-2 row-span-2 row-start-1 size-5 rounded-full" />
    </Skeleton>
  );
}

function HomeSkeleton() {
  return (
    <>
      <section className="pt-8 pb-7 text-center">
        <div aria-hidden="true" className="mb-3 flex min-h-24 items-end justify-center">
          <Skeleton className="bg-closer-coral-soft size-[88px] -rotate-[9deg] rounded-[55%_45%_57%_43%/55%_57%_43%_45%]" />
          <Skeleton className="bg-closer-lavender-soft -ml-2 size-[88px] rotate-[10deg] rounded-[44%_56%_43%_57%/57%_44%_56%_43%]" />
        </div>
        <LoadingLine className="mx-auto h-9 w-64 max-w-[82%]" />
        <LoadingLine className="mx-auto mt-3 h-4 w-48 max-w-[62%]" />
      </section>
      <section className="grid gap-3" aria-hidden="true">
        <Skeleton className="bg-closer-peach/75 shadow-closer-card h-[88px] rounded-3xl" />
        <Skeleton className="bg-closer-lavender-soft/80 shadow-closer-card h-[88px] rounded-3xl" />
      </section>
      <LoadingLine className="mx-auto mt-8 h-3 w-24" />
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-1 items-center py-10" aria-hidden="true">
      <section className="shadow-closer-soft mx-auto grid w-full max-w-[31rem] justify-items-center rounded-[1.75rem] bg-white/60 px-5 py-7">
        <Skeleton className="bg-closer-coral-soft size-16 rounded-[44%_56%_52%_48%]" />
        <LoadingLine className="mt-5 h-8 w-64 max-w-[82%]" />
        <LoadingLine className="mt-3 h-4 w-52 max-w-[70%]" />
        <Skeleton className="mt-7 h-12 w-full rounded-[1.05rem] bg-white/90" />
        <Skeleton className="bg-closer-coral-soft mt-3 h-12 w-full rounded-[1.05rem]" />
      </section>
    </div>
  );
}

export function TogetherPickerLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Opening the conversation topics…</span>
      <div aria-hidden="true" className="mt-5 grid gap-2.5">
        {loadingCategories.map((category) => (
          <LoadingCategoryCard category={category} compact key={category} />
        ))}
      </div>
    </div>
  );
}

function TogetherQuestionSkeleton() {
  return (
    <>
      <header className="flex min-h-[42px] items-center justify-between gap-3" aria-hidden="true">
        <LoadingBackButton />
        <LoadingModeBadge mode="together" />
        <span className="w-[38px]" />
      </header>
      <section
        className="flex min-h-[min(52svh,470px)] flex-1 flex-col items-center justify-center py-9 text-center"
        aria-hidden="true"
      >
        <Skeleton className="bg-closer-yellow h-9 w-[76px] rounded-full" />
        <LoadingLine className="mx-auto mt-7 h-10 w-[88%] max-w-[18rem]" />
        <LoadingLine className="mx-auto mt-2 h-10 w-[72%] max-w-[15rem]" />
        <LoadingLine className="mx-auto mt-2 h-10 w-[56%] max-w-[12rem]" />
      </section>
      <section aria-hidden="true" className="mx-auto grid w-full max-w-[330px] grid-cols-3 gap-2.5">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="grid justify-items-center gap-2" key={index}>
            <Skeleton
              className={cn(
                "shadow-closer-card size-[66px] rounded-full",
                index === 2 ? "bg-closer-coral" : "bg-white",
              )}
            />
            <LoadingLine className="h-3 w-10" />
          </div>
        ))}
      </section>
      <div
        aria-hidden="true"
        className="border-closer-navy/10 mt-6 flex justify-center border-t pt-4"
      >
        <LoadingLine className="h-4 w-20" />
      </div>
    </>
  );
}

function HistorySkeleton() {
  return (
    <>
      <section className="pt-8 pb-7" aria-hidden="true">
        <LoadingLine className="bg-closer-coral/20 h-3 w-24" />
        <LoadingLine className="mt-4 h-10 w-72 max-w-[88%]" />
        <LoadingLine className="mt-3 h-4 w-60 max-w-[75%]" />
      </section>
      <section className="grid gap-3" aria-hidden="true">
        <Skeleton className="shadow-closer-soft h-28 rounded-[1.4rem] bg-white/65" />
        <Skeleton className="shadow-closer-soft h-40 rounded-[1.4rem] bg-white/65" />
        <Skeleton className="shadow-closer-soft h-28 rounded-[1.4rem] bg-white/65" />
      </section>
    </>
  );
}

export function CloserRouteLoading({ variant }: { variant: RouteLoadingVariant }) {
  const shellClassName =
    variant === "together-question"
      ? "flex min-h-svh flex-col pb-[max(28px,env(safe-area-inset-bottom))]"
      : undefined;

  return (
    <CloserPageShell aria-busy="true" aria-live="polite" className={shellClassName}>
      {variant === "home" || variant === "form" || variant === "history" ? <CloserTopbar /> : null}
      <span className="sr-only">Opening this part of Closer…</span>
      {variant === "home" ? <HomeSkeleton /> : null}
      {variant === "form" ? <FormSkeleton /> : null}
      {variant === "history" ? <HistorySkeleton /> : null}
      {variant === "together-question" ? <TogetherQuestionSkeleton /> : null}
    </CloserPageShell>
  );
}
