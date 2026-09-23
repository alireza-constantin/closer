import { afterEach, describe, expect, test } from "bun:test";

import {
  askPrivateCandidate,
  declinePrivateRound,
  getPrivateRound,
  likePrivateCandidate,
  privateReplySchema,
  progressPrivateRound,
  removePrivateReaction,
  removePrivateReply,
  revealPrivateRound,
  setPrivateReaction,
  setPrivateReply,
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

describe("Private post-reveal interactions", () => {
  test("reactions can be set or removed by explicit commands", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(round);
    }) as typeof fetch;

    await setPrivateReaction("pair-1", "round-1", "heart");
    await removePrivateReaction("pair-1", "round-1");
    expect(calls.map(({ method, body }) => [method, body])).toEqual([
      ["PUT", { value: "heart" }],
      ["DELETE", undefined],
    ]);
    expect(calls.every(({ url }) => url.endsWith("/private-rounds/round-1/reaction"))).toBe(true);
  });

  test("reply is trimmed, limited to 500 characters, and removable", async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    globalThis.fetch = (async (_input, init) => {
      calls.push({
        method: String(init?.method),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(round);
    }) as typeof fetch;

    expect(privateReplySchema.parse({ body: "  kind thought  " }).body).toBe("kind thought");
    expect(privateReplySchema.safeParse({ body: "x".repeat(501) }).success).toBe(false);
    await setPrivateReply("pair-1", "round-1", "kind thought");
    await removePrivateReply("pair-1", "round-1");
    expect(calls).toEqual([
      { method: "PUT", body: { body: "kind thought" } },
      { method: "DELETE", body: undefined },
    ]);
  });

  test("progression retries reuse their caller-supplied idempotency key", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        ...exhausted,
        state: "CANDIDATE",
        candidate: {
          id: "candidate-2",
          liked: false,
          question: {
            id: "q2",
            questionRevisionId: "rev2",
            text: "Next?",
            category: "fun",
            intensity: "light",
          },
        },
      });
    }) as typeof fetch;
    const requestId = "stable-progress-request";
    await progressPrivateRound("pair-1", "round-1", "ask_another", "fun", requestId);
    await progressPrivateRound("pair-1", "round-1", "ask_another", "fun", requestId);
    expect(bodies).toEqual([
      { action: "ask_another", category: "fun", clientRequestId: requestId },
      { action: "ask_another", category: "fun", clientRequestId: requestId },
    ]);
  });

  test("a refreshed Round projection recovers saved reaction and reply state from the server", async () => {
    const responses = [
      round,
      {
        ...round,
        state: "REVEAL_VIEWED",
        answers: [],
        reactions: [
          { participantId: "participant-b", displayName: "B", value: "tender", isOwner: true },
        ],
        replies: [
          { participantId: "participant-b", displayName: "B", body: "still here", isOwner: true },
        ],
      },
    ];
    globalThis.fetch = (async () => Response.json(responses.shift())) as unknown as typeof fetch;

    await setPrivateReaction("pair-1", "round-1", "tender");
    const refreshed = await getPrivateRound("pair-1", "round-1");
    expect(refreshed.reactions?.find((item) => item.isOwner)?.value).toBe("tender");
    expect(refreshed.replies?.find((item) => item.isOwner)?.body).toBe("still here");
  });
});
