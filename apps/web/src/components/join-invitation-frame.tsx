import type { ReactNode } from "react";

import { Sparkles } from "lucide-react";

import { Skeleton } from "@Closer/ui/components/skeleton";

import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { CloserEyebrow } from "@/components/closer/typography";

export function JoinInvitationFrame({
  children,
  kind = "initial",
}: {
  children: ReactNode;
  kind?: "initial" | "rejoin";
}) {
  const isRejoin = kind === "rejoin";

  return (
    <OnboardingSurface>
      <OnboardingIcon tone="lavender">
        <Sparkles aria-hidden="true" />
      </OnboardingIcon>
      <CloserEyebrow className="mt-4">
        {isRejoin ? "A way back to Closer" : "An invitation for you"}
      </CloserEyebrow>
      <h1 className="mt-3 max-w-[12ch] text-[clamp(2rem,8.8vw,2.55rem)] leading-[1.03] font-extrabold tracking-[-.055em] text-balance">
        {isRejoin ? "Reconnect with your space" : "You’re invited"}
      </h1>
      <p className="text-closer-muted mt-3 max-w-[31ch] text-[.98rem] leading-relaxed">
        {isRejoin
          ? "Choose a name for a new guest profile in this space. Earlier activity stays private."
          : "Review this space, then choose Join space when you’re ready."}
      </p>
      {children}
    </OnboardingSurface>
  );
}

/** Reserves the contextual details, editable name, and CTA geometry in the real Join card. */
export function JoinInvitationDetailsSkeleton() {
  return (
    <div aria-hidden="true" className="mt-6">
      <div className="rounded-[1.35rem] bg-white/65 p-4 shadow-[0_8px_24px_rgba(27,33,78,0.08)]">
        <Skeleton className="bg-closer-navy/10 h-4 w-36 rounded-full" />
        <Skeleton className="bg-closer-navy/10 mt-3 h-4 w-28 rounded-full" />
      </div>
      <Skeleton className="bg-closer-navy/10 mt-6 h-4 w-20 rounded-full" />
      <Skeleton className="mt-2 h-11 w-full rounded-[1.05rem] bg-white/90" />
      <Skeleton className="bg-closer-coral-soft mt-5 h-12 w-full rounded-[1.05rem]" />
    </div>
  );
}
