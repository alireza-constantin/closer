import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { clearCloserQueryCache } from "./closer-query-cache";
import { closerKeys } from "./closer-query-keys";

describe("Closer auth query-cache boundary", () => {
  test("removes every participant-relative Pair and Private projection immediately", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(closerKeys.pairStatus("pair-a"), { state: "connected" });
    queryClient.setQueryData(closerKeys.privateConversations("pair-a"), [{ id: "conversation-a" }]);
    queryClient.setQueryData(closerKeys.privateRound("pair-a", "round-a"), { answer: "private" });
    queryClient.setQueryData(closerKeys.pairHistory("pair-a"), [{ id: "history-a" }]);
    queryClient.setQueryData(closerKeys.together("pair-a"), { id: "session-a" });

    clearCloserQueryCache(queryClient);

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
