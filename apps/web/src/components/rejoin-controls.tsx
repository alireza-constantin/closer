"use client";

import { RefreshCcw } from "lucide-react";
import InviteControls from "@/components/invite-controls";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { CloserEyebrow } from "@/components/closer/typography";

export default function RejoinControls({ pairId, targetName }: { pairId: string; targetName: string }) {
  return (
    <CloserPageShell className="pb-[max(28px,env(safe-area-inset-bottom))] pt-5">
      <CloserBackLink href={`/pair/${pairId}`} />
      <section className="mx-auto max-w-[34rem] px-1 pt-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-closer-lavender-soft px-3.5 py-2 text-[.87rem] font-extrabold text-closer-navy"><RefreshCcw aria-hidden="true" className="size-4" />Reconnect</span>
        <CloserEyebrow className="mt-4">A fresh way back for {targetName}</CloserEyebrow>
        <h1 className="mx-auto mt-3 max-w-[12ch] text-balance text-[clamp(2.15rem,9vw,2.8rem)] font-extrabold leading-[1.04] tracking-[-.055em]">Help them rejoin</h1>
        <p className="mx-auto mt-3 max-w-[34ch] leading-relaxed text-closer-muted">If {targetName} lost their guest session, create a new link for their existing place in your space. Either of you can do this for the other person.</p>
      </section>
      <InviteControls kind="rejoin" pairId={pairId} />
    </CloserPageShell>
  );
}
