"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

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

export default function ConnectPerson({ children, pairId }: { children: ReactNode; pairId: string }) {
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
    <>
      {joinedDisplayName ? <p className="mx-auto mt-4 inline-flex items-center rounded-full bg-closer-mint px-3 py-2 text-sm text-closer-success-foreground" role="status"><strong>{joinedDisplayName}</strong> joined. Opening your space…</p> : null}
      {isRedirecting ? <p className="mt-5 text-center text-sm text-closer-muted" role="status">Opening your shared space…</p> : children}
    </>
  );
}
