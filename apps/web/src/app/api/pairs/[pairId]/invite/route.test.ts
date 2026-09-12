import { describe, expect, mock, test } from "bun:test";

mock.module("@Closer/auth/closer", () => ({
  db: {},
  getPairForParticipant: async () => ({ pair: { relationshipType: "friend" }, members: [{ slot: "first", displayName: "Ali" }] }),
  getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
  isInitialInviteUsable: async () => true,
  issueInitialInvite: async () => ({ token: "fresh-token", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  listActivePairsForParticipant: async () => [{ pairId: "pair-1" }],
  listActivePrivateConversations: async () => [],
  revokeInitialInvites: async () => undefined,
}));

mock.module("@/lib/closer-server", () => ({
  getAuthUserIdFromRequest: async () => "auth-user-1",
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));

const { GET } = await import("./route");

describe("initial invite route", () => {
  test("returns the still-valid invite held by the creator browser", async () => {
    const response = await GET(
      new Request("http://localhost/api/pairs/pair-1/invite", {
        headers: { cookie: "closer-initial-invite-pair-1=existing-token" },
      }),
      { params: Promise.resolve({ pairId: "pair-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "existing-token" });
  });
});
