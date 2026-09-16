import { Skeleton } from "@Closer/ui/components/skeleton";

import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";

type RouteLoadingVariant = "form" | "history" | "home" | "picker";

function LoadingLine({ className }: { className: string }) {
  return <Skeleton className={`rounded-full bg-closer-navy/10 ${className}`} />;
}

function HomeSkeleton() {
  return (
    <>
      <section className="pb-7 pt-8 text-center">
        <div aria-hidden="true" className="mb-3 flex min-h-24 items-end justify-center">
          <Skeleton className="size-[88px] -rotate-[9deg] rounded-[55%_45%_57%_43%/55%_57%_43%_45%] bg-closer-coral-soft" />
          <Skeleton className="-ml-2 size-[88px] rotate-[10deg] rounded-[44%_56%_43%_57%/57%_44%_56%_43%] bg-closer-lavender-soft" />
        </div>
        <LoadingLine className="mx-auto h-9 w-64 max-w-[82%]" />
        <LoadingLine className="mx-auto mt-3 h-4 w-48 max-w-[62%]" />
      </section>
      <section className="grid gap-3" aria-hidden="true">
        <Skeleton className="h-[88px] rounded-3xl bg-closer-peach/75 shadow-closer-card" />
        <Skeleton className="h-[88px] rounded-3xl bg-closer-lavender-soft/80 shadow-closer-card" />
      </section>
      <LoadingLine className="mx-auto mt-8 h-3 w-24" />
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-1 items-center py-10" aria-hidden="true">
      <section className="mx-auto grid w-full max-w-[31rem] justify-items-center rounded-[1.75rem] bg-white/60 px-5 py-7 shadow-closer-soft">
        <Skeleton className="size-16 rounded-[44%_56%_52%_48%] bg-closer-coral-soft" />
        <LoadingLine className="mt-5 h-8 w-64 max-w-[82%]" />
        <LoadingLine className="mt-3 h-4 w-52 max-w-[70%]" />
        <Skeleton className="mt-7 h-12 w-full rounded-[1.05rem] bg-white/90" />
        <Skeleton className="mt-3 h-12 w-full rounded-[1.05rem] bg-closer-coral-soft" />
      </section>
    </div>
  );
}

function PickerSkeleton() {
  return (
    <>
      <Skeleton className="mt-2 size-10 rounded-[0.9rem] bg-closer-lavender-soft" />
      <section className="pb-7 pt-6 text-center" aria-hidden="true">
        <LoadingLine className="mx-auto h-3 w-28" />
        <LoadingLine className="mx-auto mt-4 h-9 w-64 max-w-[82%]" />
        <LoadingLine className="mx-auto mt-3 h-4 w-52 max-w-[70%]" />
      </section>
      <section className="grid grid-cols-2 gap-3" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-32 rounded-[1.35rem] bg-white/65 shadow-closer-soft" key={index} />
        ))}
      </section>
    </>
  );
}

function HistorySkeleton() {
  return (
    <>
      <section className="pb-7 pt-8" aria-hidden="true">
        <LoadingLine className="h-3 w-24 bg-closer-coral/20" />
        <LoadingLine className="mt-4 h-10 w-72 max-w-[88%]" />
        <LoadingLine className="mt-3 h-4 w-60 max-w-[75%]" />
      </section>
      <section className="grid gap-3" aria-hidden="true">
        <Skeleton className="h-28 rounded-[1.4rem] bg-white/65 shadow-closer-soft" />
        <Skeleton className="h-40 rounded-[1.4rem] bg-white/65 shadow-closer-soft" />
        <Skeleton className="h-28 rounded-[1.4rem] bg-white/65 shadow-closer-soft" />
      </section>
    </>
  );
}

export function CloserRouteLoading({ variant }: { variant: RouteLoadingVariant }) {
  return (
    <CloserPageShell aria-busy="true" aria-live="polite">
      <CloserTopbar />
      <span className="sr-only">Opening this part of Closer…</span>
      {variant === "home" ? <HomeSkeleton /> : null}
      {variant === "form" ? <FormSkeleton /> : null}
      {variant === "picker" ? <PickerSkeleton /> : null}
      {variant === "history" ? <HistorySkeleton /> : null}
    </CloserPageShell>
  );
}
