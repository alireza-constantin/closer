import { afterEach, describe, expect, test } from "bun:test";

import {
  askPrivateCandidate,
  declinePrivateRound,
  getPrivateRound,
  likePrivateCandidate,
  revealPrivateRound,
  skipPrivateCandidate,
  submitPrivateAnswer,
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

describe("Private answer and reveal commands", () => {
  test("answer posts only the canonical body and returns the viewer-relative round", async () => {
    let url = "";
    let request: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      url = String(input);
      request = init;
      return Response.json({
        ...round,
        state: "WAITING",
        yourAnswer: "  a quiet walk  ",
        hasOtherAnswer: false,
      });
    }) as typeof fetch;

    const result = await submitPrivateAnswer("pair/1", "round/1", "a quiet walk");

    expect(url).toContain("/pairs/pair%2F1/private-rounds/round%2F1/answer");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ body: "a quiet walk" });
    expect(result.state).toBe("WAITING");
    expect(result.hasOtherAnswer).toBe(false);
  });

  test("round parsing preserves reveal secrecy and reveal returns both serialized answers", async () => {
    const responses = [
      {
        ...round,
        state: "REVEAL_READY",
        yourAnswer: "FIRST-SENTINEL",
        hasOtherAnswer: true,
        answers: [],
      },
      {
        ...round,
        state: "REVEAL_VIEWED",
        yourAnswer: "FIRST-SENTINEL",
        hasOtherAnswer: true,
        answers: [
          { participantId: "a", body: "FIRST-SENTINEL" },
          { participantId: "b", body: "SECOND-SENTINEL" },
        ],
      },
    ];
    globalThis.fetch = (async () => Response.json(responses.shift())) as unknown as typeof fetch;

    const ready = await getPrivateRound("pair-1", "round-1");
    expect(ready.state).toBe("REVEAL_READY");
    expect(ready.answers).toEqual([]);
    expect(JSON.stringify(ready)).not.toContain("SECOND-SENTINEL");

    const revealed = await revealPrivateRound("pair-1", "round-1");
    expect(revealed.state).toBe("REVEAL_VIEWED");
    expect(revealed.answers?.map((answer) => answer.body)).toEqual([
      "FIRST-SENTINEL",
      "SECOND-SENTINEL",
    ]);
  });

  test("decline uses the terminal retire endpoint without an answer body", async () => {
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      request = init;
      return Response.json({ ...round, state: "DECLINED", yourAnswer: null });
    }) as typeof fetch;

    const result = await declinePrivateRound("pair-1", "round-1");

    expect(request?.method).toBe("POST");
    expect(request?.body).toBeUndefined();
    expect(result.state).toBe("DECLINED");
  });
});
