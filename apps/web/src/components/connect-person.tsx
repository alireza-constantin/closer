"use client";

import { useRouter } from "next/navigation";

import InviteControls from "@/components/invite-controls";
import { CloserBackButton } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserPageShell } from "@/components/closer/page-shell";
import { CloserEyebrow, CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";

export default function ConnectPerson({ pairId }: { pairId: string }) {
  const router = useRouter();

  return (
    <CloserPageShell className="pb-[max(28px,env(safe-area-inset-bottom))] pt-5">
      <CloserBackButton onClick={() => router.push(`/pair/${pairId}` as never)} />
      <section className="mx-auto max-w-[34rem] px-1 pt-4 text-center">
        <ModeBadge mode="private" />
        <CloserEyebrow className="mt-4">Separate phones, one shared reveal</CloserEyebrow>
        <CloserPageTitle>Connect your person</CloserPageTitle>
        <CloserSubtitle>Private questions work when you can each answer on your own phone. Send them the link below, then come back here together.</CloserSubtitle>
      </section>
      <InviteControls autoGenerate kind="initial" pairId={pairId} />
    </CloserPageShell>
  );
}
