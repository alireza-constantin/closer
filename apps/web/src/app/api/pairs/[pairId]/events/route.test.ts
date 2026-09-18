import { beforeEach, describe, expect, mock, test } from "bun:test";

let authUserId: string | null = "auth-a";
let participant: { id: string } | null = { id: "participant-a" };
let membershipAllowed = true;
let unsubscribeCalls = 0;
let subscriber:
  | ((event: { version: 1; pairId: string; type: "pair.changed" | "private.changed" }) => void)
  | undefined;

const subscribe = mock((pairId: string, callback: typeof subscriber) => {
  expect(pairId).toBe("pair-a");
  subscriber = callback;
  return () => {
    unsubscribeCalls += 1;
  };
});

mock.module("@Closer/auth/closer", () => ({
  getParticipantByAuthUserId: async () => participant,
  getPairForParticipant: async () => {
    if (!membershipAllowed) throw new Error("PAIR_NOT_FOUND");
    return { pair: { id: "pair-a" } };
  },
}));
mock.module("@Closer/db", () => ({ db: {}, getRealtimeBus: () => ({ subscribe }) }));
mock.module("@/lib/closer-server", () => ({ getAuthUserIdFromRequest: async () => authUserId }));

const { GET } = await import("./route");

function request() {
  return new Request("http://localhost/api/pairs/pair-a/events", {
    signal: new AbortController().signal,
  });
}

describe("GET /api/pairs/:pairId/events", () => {
  beforeEach(() => {
    authUserId = "auth-a";
    participant = { id: "participant-a" };
    membershipAllowed = true;
    unsubscribeCalls = 0;
    subscriber = undefined;
    subscribe.mockClear();
  });

  test("denies callers without an authenticated participating Pair membership", async () => {
    authUserId = null;
    expect((await GET(request(), { params: Promise.resolve({ pairId: "pair-a" }) })).status).toBe(
      401,
    );
    authUserId = "auth-a";
    participant = null;
    expect((await GET(request(), { params: Promise.resolve({ pairId: "pair-a" }) })).status).toBe(
      404,
    );
    participant = { id: "participant-a" };
    membershipAllowed = false;
    expect((await GET(request(), { params: Promise.resolve({ pairId: "pair-a" }) })).status).toBe(
      404,
    );
    expect(subscribe).not.toHaveBeenCalled();
  });

  test("frames authorized metadata-only named events and cleans up on cancellation", async () => {
    const controller = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/pairs/pair-a/events", { signal: controller.signal }),
      { params: Promise.resolve({ pairId: "pair-a" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("private");
    const reader = response.body!.getReader();
    const connected = await reader.read();
    expect(new TextDecoder().decode(connected.value)).toBe(": connected\n\n");
    subscriber?.({ version: 1, pairId: "pair-a", type: "private.changed" });
    const event = await reader.read();
    const framed = new TextDecoder().decode(event.value);
    expect(framed).toBe(
      'event: private.changed\ndata: {"version":1,"pairId":"pair-a","type":"private.changed"}\n\n',
    );
    expect(framed).not.toContain("answer");
    expect(framed).not.toContain("candidate");
    expect(framed).not.toContain("token");
    controller.abort();
    await reader.cancel();
    expect(unsubscribeCalls).toBeGreaterThanOrEqual(1);
  });
});
