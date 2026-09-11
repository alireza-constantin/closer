import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@Closer/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[1.05rem] border border-transparent bg-clip-padding font-sans text-sm font-extrabold whitespace-nowrap transition-[transform,background-color,box-shadow,opacity] duration-200 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-closer-navy/80 focus-visible:ring-offset-2 focus-visible:ring-offset-closer-cream active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-closer-coral text-white shadow-[0_10px_20px_rgba(255,98,110,0.24)] hover:-translate-y-0.5 hover:bg-closer-coral/90",
        outline:
          "border-closer-navy/10 bg-white text-closer-navy shadow-closer-soft hover:-translate-y-0.5 hover:bg-closer-lavender-soft/70",
        secondary:
          "bg-white text-closer-navy shadow-closer-soft hover:-translate-y-0.5 hover:bg-white/80",
        ghost:
          "text-closer-navy hover:bg-closer-lavender-soft/70 hover:text-closer-navy aria-expanded:bg-closer-lavender-soft",
        soft: "bg-closer-lavender text-white shadow-[0_10px_20px_rgba(139,118,237,0.24)] hover:-translate-y-0.5 hover:bg-closer-lavender/90",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "min-h-8 gap-1 rounded-[0.8rem] px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "min-h-10 gap-1.5 rounded-[0.9rem] px-3.5 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "min-h-[52px] gap-2 rounded-[1.1rem] px-5 py-3 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-11",
        "icon-xs": "size-8 rounded-[0.75rem] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-10 rounded-[0.85rem]",
        "icon-lg": "size-11 rounded-[0.95rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
