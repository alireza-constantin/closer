import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@Closer/ui/lib/utils";

export function CloserPageShell({ className, children, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "relative isolate mx-auto min-h-svh w-full max-w-closer-shell overflow-hidden bg-closer-cream px-6 pb-11 pt-6 text-closer-navy sm:my-4 sm:min-h-[calc(100svh-2rem)] sm:rounded-closer-shell sm:shadow-closer-shell",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 z-0 size-48 rotate-[19deg] rounded-[58%_42%_52%_48%/50%_55%_45%_50%] bg-closer-lavender-soft/60" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-20 z-0 size-48 -rotate-[25deg] rounded-[58%_42%_52%_48%/50%_55%_45%_50%] bg-closer-coral-soft/70" />
      <div className="relative z-10 flex min-h-full flex-col">{children}</div>
    </main>
  );
}

export function CloserWordmark({ href }: { href?: string }) {
  const content = (
    <>
      Closer <span aria-hidden="true" className="ml-1 text-[.92em] text-closer-coral">♥</span>
    </>
  );

  if (href) {
    return <Link className="font-sans text-[1.78rem] font-extrabold tracking-[-.055em] text-closer-navy no-underline" href={href as never}>{content}</Link>;
  }

  return <span className="font-sans text-[1.78rem] font-extrabold tracking-[-.055em] text-closer-navy">{content}</span>;
}

export function CloserPairMark() {
  return <span aria-hidden="true" className="flex items-center gap-1"><i className="block size-3 rounded-[60%_40%_62%_38%] bg-closer-coral" /><i className="mt-1 block size-3 rounded-[60%_40%_62%_38%] bg-closer-lavender" /></span>;
}

export function CloserTopbar({ href }: { href?: string }) {
  return <header className="flex min-h-[42px] items-center justify-between"><CloserWordmark href={href} /><CloserPairMark /></header>;
}

export function CloserRoundHeader({ children }: { children: ReactNode }) {
  return <header className="flex min-h-[42px] items-center justify-between">{children}</header>;
}

export function CloserCompanions({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("mb-3 flex min-h-24 items-end justify-center gap-0", className)}>
      <span className="grid size-[88px] -rotate-[9deg] place-items-center rounded-[55%_45%_57%_43%/55%_57%_43%_45%] bg-closer-coral-strong text-[1.25rem] font-extrabold tracking-[-.17em] text-closer-navy">•‿•</span>
      <span className="-ml-2 grid size-[88px] rotate-[10deg] place-items-center rounded-[44%_56%_43%_57%/57%_44%_56%_43%] bg-closer-lavender-strong text-[1.25rem] font-extrabold tracking-[-.17em] text-closer-navy">⌣⌣</span>
    </div>
  );
}
