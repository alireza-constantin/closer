import { describe, expect, mock, test } from "bun:test";

const resolveOrCreateParticipant = mock(async () => ({
  id: "participant-1",
  displayName: "Ari",
}));

mock.module("@Closer/auth/closer", () => ({
  db: {},
  resolveOrCreateParticipant,
}));

mock.module("@/lib/closer-server", () => ({
  getAuthUserIdFromRequest: async () => "auth-user-1",
}));

const { POST } = await import("./route");

describe("participant onboarding route", () => {
  test("returns the resolved participant and delegates identity-safe idempotency to the domain layer", async () => {
    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "  Ari  " }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ participantId: "participant-1", displayName: "Ari" });
    expect(resolveOrCreateParticipant).toHaveBeenCalled();
  });

  test("rejects malformed requests before persistence", async () => {
    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(resolveOrCreateParticipant).toHaveBeenCalledTimes(1);
  });
});
