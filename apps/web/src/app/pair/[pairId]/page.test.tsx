import { describe, expect, mock, test } from "bun:test";

import { createCloserAuthMock } from "@/test/closer-auth-mock";
import { createNextNavigationMock } from "@/test/next-navigation-mock";

let relationshipType: "partner" | "friend" = "friend";
let entryState: "active" | "terminated" | "unauthorized" = "active";

mock.module("@Closer/auth/closer", () =>
  createCloserAuthMock({
    getPairForParticipant: async () => ({
      pair: { relationshipType, intendedPersonName: "Nima" },
      members: [{ slot: "first", displayName: "Ali" }],
    }),
    getInitialInviteStatus: async () => ({
      state: "active",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    }),
    getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
    isInitialInviteUsable: async () => true,
    issueOrReuseInitialInvite: async () => ({
      state: "issued",
      token: "fresh-token",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    }),
    listActivePairsForParticipant: async () => [{ pairId: "pair-1" }],
    listActivePrivateConversations: async () => [],
    replaceInitialInvite: async () => ({
      token: "replacement-token",
      expiresAt: new Date("2030-01-02T00:00:00.000Z"),
    }),
  }),
);

mock.module("@/server/auth/current-participant", () => ({
  getAuthUserIdFromRequest: async () => "auth-user-1",
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));
mock.module("@/server/modules/pairs/pair.service", () => ({
  getPairEntry: async () => {
    if (entryState === "unauthorized") throw new Error("PAIR_NOT_FOUND");
    if (entryState === "terminated") return { state: "terminated" as const, pairId: "pair-1" };
    return {
      state: "active" as const,
      pair: { relationshipType, intendedPersonName: "Nima" },
      members: [{ slot: "first" as const, displayName: "Ali" }],
    };
  },
  listPairPrivateConversations: async () => [],
  listParticipantSpaces: async () => [{ pairId: "pair-1" }],
}));

mock.module("next/navigation", () =>
  createNextNavigationMock({
    notFound: () => {
      throw new Error("notFound");
    },
    redirect: () => {
      throw new Error("redirect");
    },
    unstable_rethrow: () => {},
  }),
);

mock.module("@/features/pair/components/pair-home", () => ({ default: "pair-home" }));
mock.module("@/features/pair/components/terminated-pair-screen", () => ({
  default: "terminated-pair-screen",
}));
const { default: PairPageContent } = await import("./_components/pair-page-content");

describe("Pair route entry", () => {
  test.each(["partner", "friend"] as const)(
    "passes an authorized %s Pair type to Pair Home",
    async (type) => {
      entryState = "active";
      relationshipType = type;
      const element = await PairPageContent({ params: Promise.resolve({ pairId: "pair-1" }) });

      expect(element.type).toBe("pair-home");
      expect(element.props).toMatchObject({
        isComplete: false,
        memberNames: ["Ali", null],
        intendedPersonName: "Nima",
        pairId: "pair-1",
        relationshipType: type,
      });
    },
  );

  test("renders the ended Space state for a former participant of a terminated Pair", async () => {
    entryState = "terminated";
    const element = await PairPageContent({ params: Promise.resolve({ pairId: "pair-1" }) });

    expect(element.type).toBe("terminated-pair-screen");
  });

  test("preserves not-found behavior for an unrelated participant", async () => {
    entryState = "unauthorized";
    await expect(
      PairPageContent({ params: Promise.resolve({ pairId: "pair-1" }) }),
    ).rejects.toThrow("notFound");
  });
});
