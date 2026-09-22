import type { QueryClient } from "@tanstack/react-query";

import { API_BASE_PATH } from "@/lib/api-client";

export const privateConversationKey = (pairId: string, category: string) =>
  ["private-conversation", pairId, category] as const;

export const privateRoundKey = (pairId: string, roundId: string) =>
  ["private-round", pairId, roundId] as const;

export function connectPrivateRealtime(pairId: string, queryClient: QueryClient): () => void {
  const source = new EventSource(`${API_BASE_PATH}/pairs/${encodeURIComponent(pairId)}/events`, {
    withCredentials: true,
  });
  const reconcile = () => {
    void queryClient.invalidateQueries({ queryKey: ["private-conversation", pairId] });
    void queryClient.invalidateQueries({ queryKey: ["private-round", pairId] });
  };
  source.addEventListener("open", reconcile);
  source.addEventListener("private.changed", reconcile);
  source.addEventListener("pair.terminated", () => {
    reconcile();
    source.close();
  });
  return () => source.close();
}
