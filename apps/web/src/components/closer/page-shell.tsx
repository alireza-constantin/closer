import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@Closer/ui/lib/utils";

export function CloserPageShell({ className, children, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "max-w-closer-shell bg-closer-cream text-closer-navy sm:rounded-closer-shell sm:shadow-closer-shell relative isolate mx-auto min-h-svh w-full overflow-hidden px-6 pt-6 pb-11 sm:my-4 sm:min-h-[calc(100svh-2rem)]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="bg-closer-lavender-soft/60 pointer-events-none absolute -top-24 -right-20 z-0 size-48 rotate-[19deg] rounded-[58%_42%_52%_48%/50%_55%_45%_50%]"
      />
      <span
        aria-hidden="true"
        className="bg-closer-coral-soft/70 pointer-events-none absolute -bottom-24 -left-20 z-0 size-48 -rotate-[25deg] rounded-[58%_42%_52%_48%/50%_55%_45%_50%]"
      />
      <div className="relative z-10 flex min-h-full flex-col">{children}</div>
    </main>
  );
}

export function CloserWordmark({ href }: { href?: string }) {
  const content = (
    <>
      Closer{" "}
      <span aria-hidden="true" className="text-closer-coral ml-1 text-[.92em]">
        ♥
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        className="text-closer-navy font-sans text-[1.78rem] font-extrabold tracking-[-.055em] no-underline"
        href={href as never}
        prefetch
      >
        {content}
      </Link>
    );
  }

  return (
    <span className="text-closer-navy font-sans text-[1.78rem] font-extrabold tracking-[-.055em]">
      {content}
    </span>
  );
}

export function CloserPairMark() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      <i className="bg-closer-coral block size-3 rounded-[60%_40%_62%_38%]" />
      <i className="bg-closer-lavender mt-1 block size-3 rounded-[60%_40%_62%_38%]" />
    </span>
  );
}

export function CloserTopbar({ href, action }: { href?: string; action?: ReactNode }) {
  return (
    <header className="flex min-h-[42px] items-center justify-between gap-3">
      <CloserWordmark href={href} />
      {action ?? <CloserPairMark />}
    </header>
  );
}

export function CloserRoundHeader({ children }: { children: ReactNode }) {
  return <header className="flex min-h-[42px] items-center justify-between">{children}</header>;
}

export function CloserCompanions({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("mb-3 flex min-h-24 items-end justify-center gap-0", className)}
    >
      <span className="bg-closer-coral-strong text-closer-navy grid size-[88px] -rotate-[9deg] place-items-center rounded-[55%_45%_57%_43%/55%_57%_43%_45%] text-[1.25rem] font-extrabold tracking-[-.17em]">
        •‿•
      </span>
      <span className="bg-closer-lavender-strong text-closer-navy -ml-2 grid size-[88px] rotate-[10deg] place-items-center rounded-[44%_56%_43%_57%/57%_44%_56%_43%] text-[1.25rem] font-extrabold tracking-[-.17em]">
        ⌣⌣
      </span>
    </div>
  );
}
