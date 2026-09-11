"use client";

import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

import InviteControls from "@/components/invite-controls";

export default function ConnectPerson({ pairId }: { pairId: string }) {
  const router = useRouter();

  return (
    <main className="closer-shell closer-task-shell closer-connect-person-shell">
      <button className="closer-back-button" onClick={() => router.push(`/pair/${pairId}` as never)} type="button">
        <ArrowLeft aria-hidden="true" /><span>Back</span>
      </button>
      <section className="closer-connect-person-intro">
        <span className="closer-private-pill"><LockKeyhole aria-hidden="true" /> Private</span>
        <p className="closer-eyebrow">Separate phones, one shared reveal</p>
        <h1>Connect your person</h1>
        <p>Private questions work when you can each answer on your own phone. Send them the link below, then come back here together.</p>
      </section>
      <InviteControls autoGenerate kind="initial" pairId={pairId} />
    </main>
  );
}
