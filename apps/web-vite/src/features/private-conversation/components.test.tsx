import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

import { PrivateRoundPanel } from "@/features/private-conversation/components";
import type { PrivateRound } from "@/features/private-conversation/api";

const revealedRound: PrivateRound = {
  roundId: "round-1",
  conversationId: "conversation-1",
  questionId: "question-1",
  questionRevisionId: "revision-1",
  roundNumber: 1,
  state: "REVEAL_VIEWED",
  askedAt: "2026-09-22T00:00:00Z",
  yourAnswer: "My answer",
  hasOtherAnswer: true,
  revealViewedAt: "2026-09-22T00:01:00Z",
  otherRevealViewedAt: "2026-09-22T00:02:00Z",
  otherRevealViewed: true,
  answers: [
    { participantId: "me", body: "My answer", isOwner: true },
    { participantId: "them", body: "Their revealed answer", isOwner: false },
  ],
  reactions: [
    { participantId: "me", displayName: "Me", value: "heart", isOwner: true },
    { participantId: "them", displayName: "My person", value: "tender", isOwner: false },
  ],
  replies: [
    { participantId: "me", displayName: "Me", body: "My short reply", isOwner: true },
    { participantId: "them", displayName: "My person", body: "Their short reply", isOwner: false },
  ],
  canContinue: true,
  question: { text: "What made you smile?", category: "fun", intensity: "light" },
};

function renderRound(round: PrivateRound): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        null,
        createElement(PrivateRoundPanel, {
          availableCategories: ["fun", "deep", "memories"],
          category: "fun",
          pairId: "pair-1",
          queryClient,
          round,
        }),
      ),
    ),
  );
}

describe("Private post-reveal flow", () => {
  test("shows both revealed answers, reactions, and replies", () => {
    const markup = renderRound(revealedRound);

    expect(markup).toContain("My answer");
    expect(markup).toContain("Their revealed answer");
    expect(markup).toContain("❤️");
    expect(markup).toContain("🥺");
    expect(markup).toContain("Their short reply");
    expect(markup).toContain("A short reply");
    expect(markup).toContain("Save reply");
  });

  test("shows progression only to the creator", () => {
    const creatorMarkup = renderRound(revealedRound);
    const nonCreatorMarkup = renderRound({ ...revealedRound, canContinue: false });

    expect(creatorMarkup).toContain("Ask another");
    expect(creatorMarkup).toContain("Something else");
    expect(creatorMarkup).toContain("Leave it here");
    expect(nonCreatorMarkup).not.toContain("Ask another");
    expect(nonCreatorMarkup).not.toContain("Something else");
    expect(nonCreatorMarkup).not.toContain("Leave it here");
  });

  test("keeps answer, reaction, and reply content out of the pre-reveal view", () => {
    const markup = renderRound({
      ...revealedRound,
      state: "REVEAL_READY",
      revealViewedAt: null,
      answers: [
        { participantId: "me", body: "Private own answer", isOwner: true },
        { participantId: "them", body: "Hidden other answer", isOwner: false },
      ],
      reactions: [
        { participantId: "them", displayName: "My person", value: "laugh", isOwner: false },
      ],
      replies: [
        { participantId: "them", displayName: "My person", body: "Hidden reply", isOwner: false },
      ],
      canContinue: false,
    });

    expect(markup).toContain("Reveal answers");
    expect(markup).not.toContain("Hidden other answer");
    expect(markup).not.toContain("Hidden reply");
    expect(markup).not.toContain("reacted");
    expect(markup).not.toContain("Choose a reaction");
  });
});
