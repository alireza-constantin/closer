"use client";

import { ArrowLeft, RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import InviteControls from "@/components/invite-controls";

export default function RejoinControls({ pairId, targetName }: { pairId: string; targetName: string }) {
  const router = useRouter();

  return (
    <main className="closer-shell closer-task-shell closer-rejoin-shell">
      <button className="closer-back-button" onClick={() => router.push(`/pair/${pairId}` as never)} type="button">
        <ArrowLeft aria-hidden="true" /><span>Back</span>
      </button>
      <section className="closer-connect-person-intro">
        <span className="closer-private-pill closer-rejoin-pill"><RefreshCcw aria-hidden="true" /> Reconnect</span>
        <p className="closer-eyebrow">A fresh way back for {targetName}</p>
        <h1>Help them rejoin</h1>
        <p>If {targetName} lost their guest session, create a new link for their existing place in your space. Either of you can do this for the other person.</p>
      </section>
      <InviteControls kind="rejoin" pairId={pairId} />
    </main>
  );
}
