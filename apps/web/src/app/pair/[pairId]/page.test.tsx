import { describe, expect, mock, test } from "bun:test";

mock.module("@Closer/auth/closer", () => ({
  db: {},
  getPairForParticipant: async () => ({
    pair: { relationshipType: "friend", intendedPersonName: "Nima" },
    members: [{ slot: "first", displayName: "Ali" }],
  }),
  getInitialInviteStatus: async () => ({ state: "active", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
  isInitialInviteUsable: async () => true,
  issueOrReuseInitialInvite: async () => ({ state: "issued", token: "fresh-token", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  listActivePairsForParticipant: async () => [{ pairId: "pair-1" }],
  listActivePrivateConversations: async () => [],
  replaceInitialInvite: async () => ({ token: "replacement-token", expiresAt: new Date("2030-01-02T00:00:00.000Z") }),
}));

mock.module("@/lib/closer-server", () => ({
  getAuthUserIdFromRequest: async () => "auth-user-1",
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

mock.module("@/components/pair-home", () => ({ default: "pair-home" }));
const { default: PairPage } = await import("./page");

describe("Pair route entry", () => {
  test("keeps a one-member space on Pair Home", async () => {
    const element = await PairPage({ params: Promise.resolve({ pairId: "pair-1" }) });

    expect(element.type).toBe("pair-home");
    expect(element.props).toMatchObject({
      isComplete: false,
      memberNames: ["Ali", null],
      intendedPersonName: "Nima",
      pairId: "pair-1",
    });
  });
});
