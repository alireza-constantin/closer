import type { ReactNode } from "react";

import { Skeleton } from "@Closer/ui/components/skeleton";

import { CloserBackLink } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserPageShell, CloserWordmark } from "@/components/closer/page-shell";
import { CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";

export function TogetherPickerFrame({
  children,
  pairId,
}: {
  children: ReactNode;
  pairId?: string;
}) {
  return (
    <CloserPageShell className="pt-[18px]">
      <header className="flex min-h-[42px] items-center justify-between gap-3">
        {pairId ? (
          <CloserBackLink href={`/pair/${pairId}`} label="Back to pair home" />
        ) : (
          <Skeleton aria-hidden="true" className="size-9 rounded-[.8rem] bg-white/65" />
        )}
        <CloserWordmark />
        <ModeBadge mode="together" />
      </header>
      <section className="pt-7">
        <CloserPageTitle>What kind of conversation?</CloserPageTitle>
        <CloserSubtitle>Choose a topic, then put the phone between you and talk.</CloserSubtitle>
        {children}
      </section>
    </CloserPageShell>
  );
}
