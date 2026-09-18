import { describe, expect, mock, test } from "bun:test";

const redirect = mock((destination: string): never => {
  throw new Error(`redirect:${destination}`);
});

mock.module("@Closer/auth/closer", () => ({
  db: {},
  getPairForParticipant: async () => ({
    pair: { relationshipType: "partner" },
    members: [{ slot: "first", displayName: "First member" }],
  }),
}));

mock.module("@/lib/closer-server", () => ({
  getCurrentParticipant: async () => ({ id: "participant-1" }),
}));

mock.module("@/components/private-picker", () => ({ default: "private-picker" }));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect:")) throw error;
  },
}));

const { default: PrivatePickerPage } = await import("./page");

describe("Private picker route", () => {
  test("routes an unclaimed Space to the lazy connection flow", async () => {
    await expect(
      PrivatePickerPage({ params: Promise.resolve({ pairId: "pair-1" }) }),
    ).rejects.toThrow("redirect:/pair/pair-1/invite?reason=private");
  });
});
