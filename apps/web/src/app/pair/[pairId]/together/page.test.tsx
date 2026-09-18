import { describe, expect, mock, test } from "bun:test";

import { createCloserAuthMock } from "@/test/closer-auth-mock";

let relationshipType: "partner" | "friend" = "partner";
const getPairForParticipant = mock(async () => ({ pair: { relationshipType } }));

mock.module("@Closer/auth/closer", () =>
  createCloserAuthMock({
    getPairForParticipant,
  }),
);

mock.module("@/server/auth/current-participant", () => ({
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
}));

const { default: LegacyTogetherPickerPage } = await import("./page");

describe("legacy Together picker route", () => {
  test.each(["partner", "friend"] as const)(
    "redirects an authorized %s Pair to its type-specific picker",
    async (type) => {
      relationshipType = type;

      await expect(
        LegacyTogetherPickerPage({ params: Promise.resolve({ pairId: "pair-1" }) }),
      ).rejects.toThrow(`redirect:/pair/pair-1/together/${type}`);
      expect(getPairForParticipant).toHaveBeenLastCalledWith({}, "participant-1", "pair-1");
    },
  );
});
