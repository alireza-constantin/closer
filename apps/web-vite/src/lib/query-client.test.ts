import { describe, expect, test } from "bun:test";
import { createQueryClient, clearConsumerQueryCache } from "@/lib/query-client";
import { privateHistoryKey } from "@/features/private-conversation/realtime";

describe("consumer query cache identity boundaries", () => {
  test("clears cached history when logout or replacement changes the actor", () => {
    const client = createQueryClient();
    client.setQueryData(privateHistoryKey("pair-1"), {
      pages: [{ rounds: [{ roundId: "old-member-secret" }] }],
      pageParams: [""],
    });

    clearConsumerQueryCache(client);

    expect(client.getQueryData(privateHistoryKey("pair-1"))).toBeUndefined();
  });
});
