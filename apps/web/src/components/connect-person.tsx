"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { closerKeys } from "@/lib/closer-query-keys";
import { isConnectedPairStatus } from "@/lib/pair-status";

const PAIR_STATUS_REFETCH_INTERVAL_MS = 30_000;

export default function ConnectPerson({ children, pairId }: { children: ReactNode; pairId: string }) {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const statusQuery = useQuery({
    queryKey: closerKeys.pairStatus(pairId),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/status`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Unable to refresh Pair status.");
      return response.json() as Promise<unknown>;
    },
    refetchInterval: PAIR_STATUS_REFETCH_INTERVAL_MS,
  });
  const joinedDisplayName = isConnectedPairStatus(statusQuery.data) ? statusQuery.data.otherParticipantDisplayName : null;
  useEffect(() => {
    if (!joinedDisplayName || isRedirecting) return;
    setIsRedirecting(true);
    router.replace(`/pair/${pairId}` as never);
  }, [isRedirecting, joinedDisplayName, pairId, router]);

  return (
    <>
      {joinedDisplayName ? <p className="mx-auto mt-4 inline-flex items-center rounded-full bg-closer-mint px-3 py-2 text-sm text-closer-success-foreground" role="status"><strong>{joinedDisplayName}</strong> joined. Opening your space…</p> : null}
      {isRedirecting ? <p className="mt-5 text-center text-sm text-closer-muted" role="status">Opening your shared space…</p> : children}
    </>
  );
}
