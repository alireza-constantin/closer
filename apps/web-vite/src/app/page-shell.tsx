import type { ComponentProps } from "react";
import { Link } from "react-router";

import { CloserPageShellSurface } from "@Closer/ui/components/closer-page-shell-surface";

export function PageShell({ children, ...props }: ComponentProps<typeof CloserPageShellSurface>) {
  return (
    <CloserPageShellSurface {...props}>
      <header className="flex min-h-[42px] items-center justify-between gap-3">
        <Link
          aria-label="Closer home"
          className="text-closer-navy font-sans text-[1.78rem] font-extrabold tracking-[-.055em] no-underline"
          to="/"
        >
          Closer{" "}
          <span aria-hidden="true" className="text-closer-coral ml-1 text-[.92em]">
            ♥
          </span>
        </Link>
        <span aria-hidden="true" className="flex items-center gap-1">
          <i className="bg-closer-coral block size-3 rounded-[60%_40%_62%_38%]" />
          <i className="bg-closer-lavender mt-1 block size-3 rounded-[60%_40%_62%_38%]" />
        </span>
      </header>
      {children}
    </CloserPageShellSurface>
  );
}
