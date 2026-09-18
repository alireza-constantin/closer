import type { ComponentProps } from "react";

import { cn } from "@Closer/ui/lib/utils";

export function CloserPageTitle({ className, children, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "text-4xl leading-tight font-extrabold tracking-[-.048em] text-balance",
        className,
      )}
      {...props}
    >
      {children}
    </h1>
  );
}

export function CloserSubtitle({ className, children, ...props }: ComponentProps<"p">) {
  return (
    <p className={cn("mt-2 text-sm", className)} {...props}>
      {children}
    </p>
  );
}

export function CloserEyebrow({ className, children, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-closer-muted text-[.79rem] font-extrabold tracking-[.08em] uppercase",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
