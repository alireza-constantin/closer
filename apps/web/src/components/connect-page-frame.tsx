import type { ReactNode } from "react";

import { Link as LinkIcon } from "lucide-react";

import { CloserBackLink } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserPageShell } from "@/components/closer/page-shell";
import { CloserEyebrow, CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";

/**
 * The Connect presentation deliberately contains no Pair data. This lets the
 * route stream the known destination before the authorized invite projection
 * and its credential material are available.
 */
export function ConnectPageFrame({ children, pairId }: { children: ReactNode; pairId?: string }) {
  return (
    <CloserPageShell className="pb-[max(28px,env(safe-area-inset-bottom))] pt-5">
      {pairId ? <CloserBackLink href={`/pair/${pairId}`} label="Back to space" /> : <span aria-hidden="true" className="block min-h-10" />}
      <section className="mx-auto max-w-[34rem] px-1 pt-4 text-center">
        <ModeBadge mode="private" />
        <CloserEyebrow className="mt-4">Separate phones, one shared reveal</CloserEyebrow>
        <CloserPageTitle>Connect your person</CloserPageTitle>
        <CloserSubtitle>Private questions work when you can each answer on your own phone. Send them the link below, then come back here together.</CloserSubtitle>
      </section>
      <section className="relative mx-auto mt-5 w-full max-w-136 overflow-hidden rounded-[1.625rem] border border-closer-navy/10 bg-white/70 px-5 pb-5 pt-6 text-center shadow-closer-soft">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-closer-peach/65"
        />
        <div className="relative z-10">
          <span className="mx-auto grid size-13.5 place-items-center rounded-4xl bg-closer-peach text-closer-navy [&_svg]:size-[26px]">
            <LinkIcon aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-[1.35rem] font-extrabold tracking-[-.035em]">Bring them into your space</h2>
          <p className="mx-auto mt-2 max-w-[34ch] leading-relaxed text-closer-muted">Share a private link, or let them scan the code from their phone.</p>
          <div className="mt-5">{children}</div>
        </div>
      </section>
    </CloserPageShell>
  );
}
