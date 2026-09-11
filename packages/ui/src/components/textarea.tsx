import { cn } from "@Closer/ui/lib/utils";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full resize-y rounded-closer-textarea border-2 border-transparent bg-white px-4 py-3 text-base leading-relaxed text-closer-navy shadow-[0_13px_28px_rgba(27,33,78,0.08)] transition-[box-shadow,border-color] outline-none placeholder:text-closer-muted/70 focus-visible:border-closer-lavender focus-visible:ring-4 focus-visible:ring-closer-lavender/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
