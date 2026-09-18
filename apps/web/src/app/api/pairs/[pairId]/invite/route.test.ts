import { describe, expect, mock, test } from "bun:test";

import { createCloserAuthMock } from "@/test/closer-auth-mock";

const getInitialInviteStatus = mock(async () => ({
  state: "active" as const,
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
}));
const issueOrReuseInitialInvite = mock(async () => ({
  state: "issued" as const,
  token: "fresh-token",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
}));

mock.module("@Closer/auth/closer", () =>
  createCloserAuthMock({
    getInitialInviteStatus,
    getPairForParticipant: async () => ({
      pair: { relationshipType: "friend" },
      members: [{ slot: "first", displayName: "Ali" }],
    }),
    getParticipantByAuthUserId: async () => ({ id: "participant-1" }),
    isInitialInviteUsable: async () => true,
    issueOrReuseInitialInvite,
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

const { GET, POST, PUT } = await import("./route");

describe("initial invite route", () => {
  test("returns the still-valid invite held by the creator browser", async () => {
    const response = await GET(
      new Request("http://localhost/api/pairs/pair-1/invite", {
        headers: { cookie: "closer-initial-invite-pair-1=existing-token" },
      }),
      { params: Promise.resolve({ pairId: "pair-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "local",
      token: "existing-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  test("issues a raw credential only for the requesting browser and retains it in an HttpOnly cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/pairs/pair-1/invite", { method: "POST" }),
      { params: Promise.resolve({ pairId: "pair-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "local",
      token: "fresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "closer-initial-invite-pair-1=fresh-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("shows a second browser only an active invitation and expiry, without rotating it", async () => {
    issueOrReuseInitialInvite.mockClear();
    const response = await GET(new Request("http://localhost/api/pairs/pair-1/invite"), {
      params: Promise.resolve({ pairId: "pair-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "active",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(issueOrReuseInitialInvite).not.toHaveBeenCalled();
  });

  test("replaces only through the explicit replacement command", async () => {
    const response = await PUT(
      new Request("http://localhost/api/pairs/pair-1/invite", { method: "PUT" }),
      { params: Promise.resolve({ pairId: "pair-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "local",
      token: "replacement-token",
      expiresAt: "2030-01-02T00:00:00.000Z",
    });
  });
});
