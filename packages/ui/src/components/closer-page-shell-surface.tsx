import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

export function CloserPageShellSurface({ className, children, ...props }: ComponentProps<"main">) {
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
