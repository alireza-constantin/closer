import { describe, expect, mock, test } from "bun:test";

const getCurrentParticipant = mock(async () => null as { id: string; displayName: string } | null);
const listActivePairsForParticipant = mock(async () => []);
const redirect = mock((destination: string): never => {
  throw new Error("REDIRECT:" + destination);
});

mock.module("@Closer/auth/closer", () => ({
  db: {},
  getPairForParticipant: async () => ({
    pair: { relationshipType: "friend" },
    members: [{ slot: "first", displayName: "Ali" }],
  }),
  getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
  isInitialInviteUsable: async () => true,
  issueInitialInvite: async () => ({ token: "fresh-token", expiresAt: new Date("2030-01-01T00:00:00.000Z") }),
  listActivePairsForParticipant,
  listActivePrivateConversations: async () => [],
  resolveOrCreateParticipant: mock(async () => ({ id: "participant-1", displayName: "Ari" })),
  revokeInitialInvites: async () => undefined,
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
});
