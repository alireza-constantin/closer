import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@Closer/ui/components/button";
import { cn } from "@Closer/ui/lib/utils";

import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { CloserEyebrow } from "@/components/closer/typography";

export default function ZeroSpaceHome({ displayName }: { displayName: string }) {
  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <div className="flex flex-1 items-center py-12">
        <OnboardingSurface className="items-center text-center">
          <OnboardingIcon tone="coral"><Sparkles aria-hidden="true" /></OnboardingIcon>
          <CloserEyebrow className="mt-4">You’re all set, {displayName}</CloserEyebrow>
          <h1 className="mt-3 max-w-[12ch] text-balance text-[clamp(2rem,8.8vw,2.55rem)] font-extrabold leading-[1.03] tracking-[-.055em]">Make space for someone who matters.</h1>
          <p className="mt-3 max-w-[31ch] text-[.98rem] leading-relaxed text-closer-muted">Your Closer identity is ready. Create a Space when you want to start a shared place for your conversations.</p>
          <Link className={cn(buttonVariants({ size: "lg", variant: "default" }), "mt-6 w-full")} href="/create">
            <Plus aria-hidden="true" data-icon="inline-start" />
            Create a space
          </Link>
          <p className="mt-4 text-xs leading-relaxed text-closer-muted">You can stay here and come back whenever you’re ready.</p>
        </OnboardingSurface>
      </div>
    </CloserPageShell>
  );
}
