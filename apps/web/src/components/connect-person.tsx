"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import InviteControls from "@/components/invite-controls";
import { CloserBackLink } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserPageShell } from "@/components/closer/page-shell";
import { CloserEyebrow, CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";
import { useVisiblePolling } from "@/hooks/use-visible-polling";

const PAIR_STATUS_POLL_INTERVAL_MS = 5_000;

function isConnectedPairStatus(value: unknown): value is { state: "connected"; otherParticipantDisplayName: string } {
  return (
    !!value
    && typeof value === "object"
    && "state" in value
    && value.state === "connected"
    && "otherParticipantDisplayName" in value
    && typeof value.otherParticipantDisplayName === "string"
  );
}

export default function ConnectPerson({ pairId, issueOnEntry = false }: { pairId: string; issueOnEntry?: boolean }) {
  const router = useRouter();
  const [joinedDisplayName, setJoinedDisplayName] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useVisiblePolling({
    enabled: joinedDisplayName === null && !isRedirecting,
    forceOnForeground: true,
    intervalMs: PAIR_STATUS_POLL_INTERVAL_MS,
    onPoll: async (signal) => {
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/status`, { cache: "no-store", signal });
        if (!response.ok) return;
        const status: unknown = await response.json();
        if (!isConnectedPairStatus(status)) return;
        setJoinedDisplayName(status.otherParticipantDisplayName);
        setIsRedirecting(true);
        router.replace(`/pair/${pairId}` as never);
      } catch {
        // A transient status failure leaves the invite state intact for the next check.
      }
    },
  });

  return (
    <CloserPageShell className="pb-[max(28px,env(safe-area-inset-bottom))] pt-5">
      <CloserBackLink href={`/pair/${pairId}`} label="Back to space" />
      <section className="mx-auto max-w-[34rem] px-1 pt-4 text-center">
        <ModeBadge mode="private" />
        <CloserEyebrow className="mt-4">Separate phones, one shared reveal</CloserEyebrow>
        <CloserPageTitle>Connect your person</CloserPageTitle>
        <CloserSubtitle>Private questions work when you can each answer on your own phone. Send them the link below, then come back here together.</CloserSubtitle>
      </section>
      {joinedDisplayName ? <p className="mx-auto mt-4 inline-flex items-center rounded-full bg-closer-mint px-3 py-2 text-sm text-closer-success-foreground" role="status"><strong>{joinedDisplayName}</strong> joined. Opening your space…</p> : null}
      {isRedirecting ? <p className="text-center text-sm text-closer-muted" role="status">Opening your shared space…</p> : <InviteControls autoGenerate={issueOnEntry} kind="initial" pairId={pairId} />}
    </CloserPageShell>
  );
}
