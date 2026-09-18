export const closerKeys = {
  pair: (pairId: string) => ["closer", "pair", pairId] as const,
  pairStatus: (pairId: string) => ["closer", "pair", pairId, "status"] as const,
  privateRoot: (pairId: string) => ["closer", "pair", pairId, "private"] as const,
  privateConversations: (pairId: string) => ["closer", "pair", pairId, "private", "conversations"] as const,
  privateConversation: (pairId: string, conversationId: string) => ["closer", "pair", pairId, "private", "conversation", conversationId] as const,
  privateRound: (pairId: string, roundId: string) => ["closer", "pair", pairId, "private", "round", roundId] as const,
  together: (pairId: string) => ["closer", "pair", pairId, "together"] as const,
  pairHistory: (pairId: string) => ["closer", "pair", pairId, "history"] as const,
};
