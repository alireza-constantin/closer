import { afterEach, describe, expect, test } from "bun:test";

import {
  askPrivateCandidate,
  likePrivateCandidate,
  skipPrivateCandidate,
} from "@/features/private-conversation/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const round = {
  roundId: "round-1",
  conversationId: "conversation-1",
  questionId: "question-1",
  questionRevisionId: "revision-1",
  roundNumber: 1,
  state: "open",
  askedAt: "2026-09-22T00:00:00Z",
  question: { text: "A careful question", category: "fun", intensity: "light" },
};

const exhausted = {
  pairId: "pair-1",
  conversationId: "conversation-1",
  category: "fun",
  state: "EXHAUSTED",
};

describe("Private candidate commands", () => {
  test("Ask uses the canonical select contract and returns a clean Round", async () => {
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      request = init;
      return Response.json(round, { status: 201 });
    }) as typeof fetch;

    const result = await askPrivateCandidate(
      "pair-1",
      "conversation-1",
      "candidate-1",
      "request-1",
    );

    expect(result.roundId).toBe("round-1");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ clientRequestId: "request-1" });
  });

  test("Skip keeps the same clientRequestId stable across a transport retry", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(exhausted);
    }) as typeof fetch;

    await skipPrivateCandidate("pair-1", "conversation-1", "candidate-1", "stable-request");
    await skipPrivateCandidate("pair-1", "conversation-1", "candidate-1", "stable-request");

    expect(bodies).toEqual([
      { clientRequestId: "stable-request" },
      { clientRequestId: "stable-request" },
    ]);
  });

  test("Like is an explicit set/unset command", async () => {
    let body: unknown;
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ liked: false });
    }) as typeof fetch;

    const result = await likePrivateCandidate("pair-1", "conversation-1", "candidate-1", false);

    expect(result).toEqual({ liked: false });
    expect(body).toEqual({ liked: false });
  });
});
