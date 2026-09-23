import type { QueryClient } from "@tanstack/react-query";

import { connectPairRealtime } from "@/features/pair/realtime";

export const privateConversationKey = (pairId: string, category: string) =>
  ["private-conversation", pairId, category] as const;

export const privateRoundKey = (pairId: string, roundId: string) =>
  ["private-round", pairId, roundId] as const;

export const privateHistoryKey = (pairId: string) => ["private-history", pairId] as const;

export function connectPrivateRealtime(pairId: string, queryClient: QueryClient): () => void {
  return connectPairRealtime(pairId, queryClient);
}
