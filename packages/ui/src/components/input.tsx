import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@Closer/ui/lib/utils";
import * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "min-h-[54px] w-full min-w-0 rounded-closer-input border-2 border-transparent bg-white/80 px-4 py-3 text-base text-closer-navy shadow-[inset_0_0_0_1px_rgba(16,37,101,0.09)] transition-[box-shadow,border-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-closer-muted/70 focus-visible:border-closer-lavender focus-visible:ring-4 focus-visible:ring-closer-lavender/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
