import { describe, expect, mock, test } from "bun:test";

const getCurrentParticipant = mock(async () => null as { id: string; displayName: string } | null);
const listActivePairsForParticipant = mock(async () => []);
const redirect = mock((destination: string): never => {
  throw new Error("REDIRECT:" + destination);
});

mock.module("@Closer/auth/closer", () => ({
  createPairForParticipant: async () => ({ pair: { id: "pair-1", intendedPersonName: "Nima" } }),
  db: {},
  getPairForParticipant: async () => ({
    pair: { relationshipType: "friend" },
    members: [{ slot: "first", displayName: "Ali" }],
  }),
  getInitialInviteStatus: async () => ({ state: "active", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
  isInitialInviteUsable: async () => true,
  issueOrReuseInitialInvite: async () => ({ state: "issued", token: "fresh-token", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  listActivePairsForParticipant,
  listActivePrivateConversations: async () => [],
  resolveOrCreateParticipant: mock(async () => ({ id: "participant-1", displayName: "Ari" })),
  replaceInitialInvite: async () => ({ token: "replacement-token", expiresAt: new Date("2030-01-02T00:00:00.000Z") }),
}));

mock.module("@/lib/closer-server", () => ({
  getCurrentParticipant,
  getAuthUserIdFromRequest: async () => "auth-user-1",
}));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect,
  unstable_rethrow: () => {},
}));
mock.module("@/components/zero-space-home", () => ({ default: "zero-space-home" }));
mock.module("@/components/your-spaces", () => ({ default: "your-spaces" }));

const { default: Home } = await import("./page");

describe("root entry", () => {
  test("sends a session without a Participant to onboarding", async () => {
    getCurrentParticipant.mockResolvedValueOnce(null);

    await expect(Home()).rejects.toThrow("REDIRECT:/onboarding");
  });

  test("shows the optional Space creation state for a Participant with zero Spaces", async () => {
    getCurrentParticipant.mockResolvedValueOnce({ id: "participant-1", displayName: "Ari" });
    listActivePairsForParticipant.mockResolvedValueOnce([]);

    const element = await Home();

    expect(element.type).toBe("zero-space-home");
    expect(element.props).toEqual({ displayName: "Ari" });
  });

  test("fast-paths exactly one active Space to its Pair Home", async () => {
    getCurrentParticipant.mockResolvedValueOnce({ id: "participant-1", displayName: "Ari" });
    listActivePairsForParticipant.mockResolvedValueOnce([{ pairId: "pair-1" }]);

    await expect(Home()).rejects.toThrow("REDIRECT:/pair/pair-1");
  });

  test("shows every active Space when a Participant has multiple Spaces", async () => {
    const spaces = [
      { pairId: "pair-1", relationshipType: "partner", state: "waiting", otherParticipantDisplayName: null, intendedPersonName: "Nima" },
      { pairId: "pair-2", relationshipType: "friend", state: "connected", otherParticipantDisplayName: "Sara", intendedPersonName: null },
    ];
    getCurrentParticipant.mockResolvedValueOnce({ id: "participant-1", displayName: "Ari" });
    listActivePairsForParticipant.mockResolvedValueOnce(spaces);

    const element = await Home();

    expect(element.type).toBe("your-spaces");
    expect(element.props).toEqual({ spaces });
  });
});
