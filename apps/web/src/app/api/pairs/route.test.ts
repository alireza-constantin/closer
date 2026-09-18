import { describe, expect, mock, test } from "bun:test";

import { createCloserAuthMock } from "@/test/closer-auth-mock";

const createPairForParticipant = mock(async () => ({
  pair: { id: "pair-1", intendedPersonName: "Nima" },
}));

mock.module("@Closer/auth/closer", () =>
  createCloserAuthMock({
    createPairForParticipant,
    getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
  }),
);

mock.module("@/server/auth/current-participant", () => ({
  getAuthUserIdFromRequest: async () => "auth-user-1",
}));

const { POST } = await import("./route");

describe("create Space route", () => {
  test("requires the intended person name and forwards the existing Participant", async () => {
    const response = await POST(
      new Request("http://localhost/api/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intendedPersonName: "  Nima  ", relationshipType: "friend" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pairId: "pair-1", intendedPersonName: "Nima" });
    expect(createPairForParticipant).toHaveBeenCalledWith(expect.anything(), {
      participantId: "participant-1",
      intendedPersonName: "  Nima  ",
      relationshipType: "friend",
      clientRequestId: undefined,
    });
  });

  test("rejects a request without an intended person before persistence", async () => {
    const response = await POST(
      new Request("http://localhost/api/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relationshipType: "partner" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createPairForParticipant).toHaveBeenCalledTimes(1);
  });
});
