import { afterEach, describe, expect, test } from "bun:test";

import { terminatePair } from "@/features/consumer/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Pair termination API", () => {
  test("sends the explicit termination command and parses its terminal projection", async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return Response.json({
        pairId: "pair-1",
        state: "terminated",
        terminatedAt: "2026-09-23T12:00:00Z",
      });
    }) as typeof fetch;

    await expect(terminatePair("pair-1")).resolves.toEqual({
      pairId: "pair-1",
      state: "terminated",
      terminatedAt: "2026-09-23T12:00:00Z",
    });
    expect(capturedInput).toBe("/api/v1/pairs/pair-1/terminate");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBeUndefined();
  });
});
