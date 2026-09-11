import type { ComponentProps } from "react";

import { cn } from "@Closer/ui/lib/utils";

export function CloserPageTitle({ className, children, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-balance text-4xl font-extrabold leading-tight tracking-[-.048em]", className)} {...props}>{children}</h1>;
}

export function CloserSubtitle({ className, children, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-2 text-sm", className)} {...props}>{children}</p>;
}

export function CloserEyebrow({ className, children, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[.79rem] font-extrabold uppercase tracking-[.08em] text-closer-muted", className)} {...props}>{children}</p>;
}
