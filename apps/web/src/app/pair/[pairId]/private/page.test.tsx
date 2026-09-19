import { describe, expect, mock, test } from "bun:test";

import { createCloserAuthMock } from "@/test/closer-auth-mock";

const redirect = mock((destination: string): never => {
  throw new Error(`redirect:${destination}`);
});

mock.module("@Closer/auth/closer", () =>
  createCloserAuthMock({
    getPairForParticipant: async () => ({
      pair: { relationshipType: "partner" },
      members: [{ slot: "first", displayName: "First member" }],
    }),
  }),
);

mock.module("@/server/auth/current-participant", () => ({
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));
mock.module("@/server/modules/pairs/pair.service", () => ({
  getAuthorizedPair: async () => ({
    pair: { relationshipType: "partner" },
    members: [{ slot: "first", displayName: "First member" }],
  }),
  listPairPrivateConversations: async () => [],
  listParticipantSpaces: async () => [],
}));

mock.module("@/features/private-conversation/components/private-picker", () => ({
  default: "private-picker",
}));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect:")) throw error;
  },
}));

const { default: PrivatePickerPageContent } =
  await import("./_components/private-picker-page-content");

describe("Private picker route", () => {
  test("routes an unclaimed Space to the lazy connection flow", async () => {
    await expect(
      PrivatePickerPageContent({ params: Promise.resolve({ pairId: "pair-1" }) }),
    ).rejects.toThrow("redirect:/pair/pair-1/invite?reason=private");
  });
});
