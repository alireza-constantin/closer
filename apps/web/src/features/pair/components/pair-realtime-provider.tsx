"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as navigation from "next/navigation";
import { useEffect } from "react";

import { closerKeys } from "@/lib/query/closer-query-keys";

type EventType = "pair.changed" | "private.changed" | "together.changed" | "pair.terminated";

function invalidateForEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  pairId: string,
  type: EventType,
) {
  if (type === "pair.changed") {
    void queryClient.invalidateQueries({ queryKey: closerKeys.pairStatus(pairId) });
    return;
  }
  if (type === "private.changed") {
    void queryClient.invalidateQueries({ queryKey: closerKeys.privateRoot(pairId) });
    return;
  }
  if (type === "together.changed") {
    void queryClient.invalidateQueries({ queryKey: closerKeys.together(pairId) });
    return;
  }
  void queryClient.invalidateQueries({ queryKey: closerKeys.pair(pairId) });
}

/** Transport seam: one instance is created by the Pair layout effect. */
export function createPairRealtimeSubscription(
  queryClient: ReturnType<typeof useQueryClient>,
  pairId: string,
  onTerminated?: () => void,
) {
  const source = new EventSource(`/api/pairs/${encodeURIComponent(pairId)}/events`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  const reconcile = () => {
    void queryClient.invalidateQueries({ queryKey: closerKeys.pairStatus(pairId) });
    void queryClient.invalidateQueries({ queryKey: closerKeys.privateRoot(pairId) });
  };
  const onEvent = (event: MessageEvent<string>) => {
    if (closed) return;
    try {
      const payload: unknown = JSON.parse(event.data);
      if (!payload || typeof payload !== "object" || !("type" in payload) || !("pairId" in payload))
        return;
      const { type, pairId: eventPairId } = payload as { type?: unknown; pairId?: unknown };
      // A source is scoped to one Pair. Do not let a stale source (or malformed
      // transport message) invalidate the cache for the newly-rendered Pair.
      if (eventPairId !== pairId) return;
      if (type === "pair.terminated") {
        // EventSource reconnects automatically after its connection ends. A
        // terminated Pair no longer authorizes this active-only endpoint, so
        // close before navigation rather than letting it retry as 404s.
        close();
        onTerminated?.();
        return;
      }
      if (type === "pair.changed" || type === "private.changed" || type === "together.changed") {
        invalidateForEvent(queryClient, pairId, type);
      }
    } catch {
      /* Ignore malformed transport data. */
    }
  };
  source.addEventListener("open", reconcile);
  source.addEventListener("pair.changed", onEvent);
  source.addEventListener("private.changed", onEvent);
  source.addEventListener("together.changed", onEvent);
  source.addEventListener("pair.terminated", onEvent);
  return close;
}

export function PairRealtimeProvider({
  pairId,
  children,
}: {
  pairId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = navigation.useRouter();
  useEffect(() => {
    return createPairRealtimeSubscription(queryClient, pairId, () => {
      router.replace(`/pair/${pairId}` as never);
    });
  }, [pairId, queryClient, router]);
  return children;
}
