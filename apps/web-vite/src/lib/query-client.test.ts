import { describe, expect, test } from "bun:test";
import { createQueryClient, clearActorQueryCache } from "@/lib/query-client";
import { privateHistoryKey } from "@/features/private-conversation/realtime";
import { adminSessionKey } from "@/features/admin/api";

describe("actor query cache identity boundaries", () => {
  test("clears cached history when logout or replacement changes the actor", () => {
    const client = createQueryClient();
    client.setQueryData(privateHistoryKey("pair-1"), {
      pages: [{ rounds: [{ roundId: "old-member-secret" }] }],
      pageParams: [""],
    });

    clearActorQueryCache(client);

    expect(client.getQueryData(privateHistoryKey("pair-1"))).toBeUndefined();
  });

  test("does not retain consumer or prior Admin data when an Admin signs in", () => {
    const client = createQueryClient();
    client.setQueryData(privateHistoryKey("pair-1"), "former-consumer-answer");
    client.setQueryData(["admin", "analytics", "question-1"], "prior-admin-analytics");

    clearActorQueryCache(client);
    client.setQueryData(adminSessionKey, { actor: { authUserId: "admin-1", kind: "admin" } });

    expect(client.getQueryData(privateHistoryKey("pair-1"))).toBeUndefined();
    expect(client.getQueryData(["admin", "analytics", "question-1"])).toBeUndefined();
    expect(client.getQueryData(adminSessionKey) as unknown).toEqual({
      actor: { authUserId: "admin-1", kind: "admin" },
    });
  });
});
