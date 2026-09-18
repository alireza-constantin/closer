import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@Closer/ui/components/button";
import { cn } from "@Closer/ui/lib/utils";

import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { CloserEyebrow } from "@/components/closer/typography";

export default function TerminatedPairScreen() {
  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar href="/" />
      <div className="flex flex-1 items-center py-12">
        <OnboardingSurface className="items-center text-center">
          <OnboardingIcon tone="lavender">
            <Sparkles aria-hidden="true" />
          </OnboardingIcon>
          <CloserEyebrow className="mt-4">A gentle ending</CloserEyebrow>
          <h1 className="mt-3 max-w-[12ch] text-[clamp(2rem,8.8vw,2.55rem)] leading-[1.03] font-extrabold tracking-[-.055em] text-balance">
            This Space has ended
          </h1>
          <p className="text-closer-muted mt-3 max-w-[31ch] text-[.98rem] leading-relaxed">
            This Space is no longer active. You can start a new one whenever you’re ready.
          </p>
          <Link
            className={cn(buttonVariants({ size: "lg", variant: "default" }), "mt-6 w-full")}
            href="/create"
            prefetch
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Create a new Space
          </Link>
        </OnboardingSurface>
      </div>
    </CloserPageShell>
  );
}
