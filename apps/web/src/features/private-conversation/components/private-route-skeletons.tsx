import { Skeleton } from "@Closer/ui/components/skeleton";
import { cn } from "@Closer/ui/lib/utils";

import {
  categoriesForRelationship,
  categorySurfaceClass,
  type CloserCategory,
} from "@/components/closer/category";
import { CloserPageShell, CloserRoundHeader } from "@/components/closer/page-shell";

const loadingCategories = categoriesForRelationship("partner");

function LoadingLine({ className }: { className: string }) {
  return <Skeleton className={`bg-closer-navy/10 rounded-full ${className}`} />;
}

function LoadingBackButton() {
  return <Skeleton aria-hidden="true" className="size-9 rounded-[.8rem] bg-white/65" />;
}

function LoadingModeBadge() {
  return (
    <Skeleton aria-hidden="true" className="bg-closer-lavender-soft h-9 w-[76px] rounded-full" />
  );
}

function PrivateSkeletonShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <CloserPageShell aria-busy="true" aria-live="polite" className="pt-5">
      <span className="sr-only">{label}</span>
      {children}
    </CloserPageShell>
  );
}

function LoadingCategoryCard({ category }: { category: CloserCategory }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={cn(
        "shadow-closer-soft grid min-h-[78px] w-full grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[1.3rem] px-[18px] py-4 text-left",
        categorySurfaceClass(category),
      )}
    >
      <LoadingLine className="bg-closer-navy/20 h-4 w-20" />
      <LoadingLine className="bg-closer-navy/15 col-start-1 h-3 w-44 max-w-full" />
      <Skeleton className="bg-closer-navy/15 col-start-2 row-span-2 row-start-1 size-5 rounded-full" />
    </Skeleton>
  );
}

/** Matches the Private topic picker while its server projection resolves. */
export function PrivatePickerSkeleton() {
  return (
    <PrivateSkeletonShell label="Opening private topics…">
      <LoadingBackButton />
      <section aria-label="Private picker loading" className="pt-10">
        <LoadingModeBadge />
        <LoadingLine className="mt-6 h-10 w-[78%] max-w-[18rem]" />
        <LoadingLine className="mt-3 h-10 w-[52%] max-w-[12rem]" />
        <LoadingLine className="mt-3 h-4 w-[88%] max-w-[20rem]" />
        <LoadingLine className="mt-2 h-4 w-[66%] max-w-[15rem]" />
        <div className="mt-6 grid gap-2.5" aria-hidden="true">
          {loadingCategories.map((category) => (
            <LoadingCategoryCard category={category} key={category} />
          ))}
        </div>
      </section>
    </PrivateSkeletonShell>
  );
}

/** Matches the creator/waiting conversation screen without borrowing picker geometry. */
export function PrivateConversationSkeleton() {
  return (
    <PrivateSkeletonShell label="Opening the private conversation…">
      <LoadingBackButton />
      <section aria-label="Private conversation loading" className="pt-10">
        <LoadingModeBadge />
        <LoadingLine className="mt-6 h-3 w-20" />
        <LoadingLine className="mt-4 h-10 w-[82%] max-w-[18rem]" />
        <LoadingLine className="mt-2 h-10 w-[68%] max-w-[15rem]" />
        <LoadingLine className="mt-2 h-10 w-[52%] max-w-[12rem]" />
        <LoadingLine className="mt-4 h-4 w-[88%] max-w-[20rem]" />
        <LoadingLine className="mt-2 h-4 w-[66%] max-w-[15rem]" />
        <div className="mt-8 grid gap-3" aria-hidden="true">
          <Skeleton className="bg-closer-coral-soft h-12 rounded-[1.05rem]" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-12 rounded-[1.05rem] bg-white/90" />
            <Skeleton className="bg-closer-lavender-soft h-12 rounded-[1.05rem]" />
          </div>
        </div>
      </section>
    </PrivateSkeletonShell>
  );
}

/** Mirrors the answer form's header, prompt, textarea, actions, and safe-area spacing. */
export function PrivateRoundSkeleton() {
  return (
    <PrivateSkeletonShell label="Opening your private answer…">
      <CloserRoundHeader>
        <LoadingBackButton />
        <LoadingModeBadge />
        <span aria-hidden="true" className="w-[38px]" />
      </CloserRoundHeader>
      <section
        aria-label="Private answer loading"
        className="flex min-h-[calc(100svh-100px)] flex-col items-center pt-6"
      >
        <Skeleton aria-hidden="true" className="bg-closer-yellow h-9 w-[76px] rounded-full" />
        <LoadingLine className="mt-3 h-3 w-36" />
        <LoadingLine className="mt-7 h-10 w-[88%] max-w-[18rem]" />
        <LoadingLine className="mt-2 h-10 w-[72%] max-w-[15rem]" />
        <LoadingLine className="mt-2 h-10 w-[56%] max-w-[12rem]" />
        <div className="mt-auto flex w-full flex-col pt-7" aria-hidden="true">
          <Skeleton className="min-h-[132px] w-full rounded-[1.05rem] bg-white/90" />
          <Skeleton className="bg-closer-coral-soft mt-[18px] h-12 w-full rounded-[1.05rem]" />
          <Skeleton className="mt-3 h-12 w-full rounded-[1.05rem] bg-white/65" />
          <LoadingLine className="mx-auto mt-4 h-3 w-56 max-w-full" />
        </div>
      </section>
    </PrivateSkeletonShell>
  );
}
