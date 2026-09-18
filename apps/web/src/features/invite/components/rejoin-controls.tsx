"use client";

import { RefreshCcw } from "lucide-react";
import InviteControls from "@/features/invite/components/invite-controls";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { CloserEyebrow } from "@/components/closer/typography";

export default function RejoinControls({
  pairId,
  targetName,
}: {
  pairId: string;
  targetName: string;
}) {
  return (
    <CloserPageShell className="pt-5 pb-[max(28px,env(safe-area-inset-bottom))]">
      <CloserBackLink href={`/pair/${pairId}`} />
      <section className="mx-auto max-w-[34rem] px-1 pt-4 text-center">
        <span className="bg-closer-lavender-soft text-closer-navy inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[.87rem] font-extrabold">
          <RefreshCcw aria-hidden="true" className="size-4" />
          Reconnect
        </span>
        <CloserEyebrow className="mt-4">A fresh way back for {targetName}</CloserEyebrow>
        <h1 className="mx-auto mt-3 max-w-[12ch] text-[clamp(2.15rem,9vw,2.8rem)] leading-[1.04] font-extrabold tracking-[-.055em] text-balance">
          Help them rejoin
        </h1>
        <p className="text-closer-muted mx-auto mt-3 max-w-[34ch] leading-relaxed">
          If {targetName} lost their guest session, create a new link for their existing place in
          your space. Either of you can do this for the other person.
        </p>
      </section>
      <InviteControls kind="rejoin" pairId={pairId} />
    </CloserPageShell>
  );
}
