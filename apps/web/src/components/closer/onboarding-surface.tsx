import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";

import { cn } from "@Closer/ui/lib/utils";

type SurfaceBaseProps = { children?: ReactNode; className?: string };
type OnboardingFormProps = SurfaceBaseProps & Omit<ComponentPropsWithoutRef<"form">, "children" | "className"> & { as: "form" };
type OnboardingSectionProps = SurfaceBaseProps & Omit<ComponentPropsWithoutRef<"section">, "children" | "className"> & { as?: "section" };

const onboardingSurfaceClass = "mx-auto flex w-full max-w-closer-form flex-col rounded-closer-panel bg-white/65 px-6 pb-6 pt-7 shadow-closer-soft backdrop-blur-[2px]";

export function OnboardingSurface(props: OnboardingFormProps): ReactElement;
export function OnboardingSurface(props: OnboardingSectionProps): ReactElement;
export function OnboardingSurface(props: OnboardingFormProps | OnboardingSectionProps) {
  const { as = "section", children, className, ...rest } = props;
  const surfaceClass = cn(onboardingSurfaceClass, className);

  if (as === "form") {
    return <form className={surfaceClass} {...(rest as ComponentPropsWithoutRef<"form">)}>{children}</form>;
  }

  return <section className={surfaceClass} {...(rest as ComponentPropsWithoutRef<"section">)}>{children}</section>;
}

export function OnboardingIcon({ children, tone }: { children: ReactNode; tone: "coral" | "lavender" }) {
  return <span className={cn("grid size-[54px] place-items-center rounded-[1.25rem] text-closer-navy [&_svg]:size-[26px]", tone === "coral" ? "bg-closer-coral-soft" : "bg-closer-lavender-soft")}>{children}</span>;
}
