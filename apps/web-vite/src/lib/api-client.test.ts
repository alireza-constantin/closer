import { afterEach, describe, expect, test } from "bun:test";

import { ApiError, requestJson } from "@/lib/api-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("versioned JSON API client", () => {
  test("uses a same-origin API path, JSON body, and caller cancellation signal", async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return Response.json({ ok: true });
    }) as typeof fetch;

    const controller = new AbortController();
    const result = await requestJson<{ ok: boolean }>("/me", {
      method: "POST",
      body: { ready: true },
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: true });
    expect(capturedInput).toBe("/api/v1/me");
    expect(capturedInit?.credentials).toBe("same-origin");
    expect(capturedInit?.signal).toBe(controller.signal);
    expect(capturedInit?.headers).toBeInstanceOf(Headers);
    expect((capturedInit?.headers as Headers).get("content-type")).toBe("application/json");
    expect(capturedInit?.body).toBe('{"ready":true}');
  });

  test("parses the stable error envelope without leaking unknown response data", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "The credentials were not accepted.",
            requestId: "request-123",
          },
          internal: "not part of the error contract",
        },
        { status: 401 },
      )) as unknown as typeof fetch;

    await expect(requestJson("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "INVALID_CREDENTIALS",
      requestId: "request-123",
      message: "The credentials were not accepted.",
    });
  });

  test("uses a stable fallback for non-contract HTTP errors", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { detail: "database URL must stay private" },
        { status: 500 },
      )) as unknown as typeof fetch;

    try {
      await requestJson("/me");
      throw new Error("Expected the request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 500,
        code: "HTTP_ERROR",
        requestId: null,
        message: "The request could not be completed.",
      });
      expect((error as Error).message).not.toContain("database URL");
    }
  });

  test("rejects absolute and path-traversal URLs before making a request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch;

    await expect(requestJson("https://example.test/api/v1/me")).rejects.toBeInstanceOf(TypeError);
    await expect(requestJson("../admin/login")).rejects.toBeInstanceOf(TypeError);
    expect(called).toBe(false);
  });
});
