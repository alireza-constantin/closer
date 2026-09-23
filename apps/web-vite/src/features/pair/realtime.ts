import type { QueryClient } from "@tanstack/react-query";

import { API_BASE_PATH } from "@/lib/api-client";

export const pairQueryKey = (pairId: string) => ["pair", pairId] as const;

export function connectPairRealtime(pairId: string, queryClient: QueryClient): () => void {
  const source = new EventSource(`${API_BASE_PATH}/pairs/${encodeURIComponent(pairId)}/events`, {
    withCredentials: true,
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  const invalidatePrivate = () => {
    void queryClient.invalidateQueries({ queryKey: ["private-conversation", pairId] });
    void queryClient.invalidateQueries({ queryKey: ["private-round", pairId] });
    void queryClient.invalidateQueries({ queryKey: ["private-history", pairId] });
  };
  const reconcile = () => {
    void queryClient.invalidateQueries({ queryKey: ["spaces"] });
    invalidatePrivate();
    void queryClient.invalidateQueries({ queryKey: ["together", pairId] });
  };
  const isForPair = (event: Event) => {
    try {
      const payload: unknown = JSON.parse((event as MessageEvent<string>).data);
      return (
        payload !== null &&
        typeof payload === "object" &&
        "pairId" in payload &&
        payload.pairId === pairId
      );
    } catch {
      return false;
    }
  };
  source.addEventListener("open", reconcile);
  source.addEventListener("pair.changed", (event) => {
    if (isForPair(event)) {
      void queryClient.invalidateQueries({ queryKey: pairQueryKey(pairId) });
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
    }
  });
  source.addEventListener("private.changed", (event) => {
    if (isForPair(event)) invalidatePrivate();
  });
  source.addEventListener("together.changed", (event) => {
    if (isForPair(event)) void queryClient.invalidateQueries({ queryKey: ["together", pairId] });
  });
  source.addEventListener("pair.terminated", (event) => {
    if (!isForPair(event)) return;
    queryClient.setQueryData<unknown>(pairQueryKey(pairId), (current: unknown) =>
      current && typeof current === "object" ? { ...current, state: "terminated" } : current,
    );
    void queryClient.cancelQueries({ queryKey: ["private-conversation", pairId] });
    void queryClient.cancelQueries({ queryKey: ["private-round", pairId] });
    void queryClient.cancelQueries({ queryKey: ["together", pairId] });
    queryClient.removeQueries({ queryKey: ["private-conversation", pairId] });
    queryClient.removeQueries({ queryKey: ["private-round", pairId] });
    queryClient.removeQueries({ queryKey: ["together", pairId] });
    void queryClient.invalidateQueries({ queryKey: ["private-history", pairId] });
    void queryClient.invalidateQueries({ queryKey: ["spaces"] });
    close();
  });
  return close;
}
