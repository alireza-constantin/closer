import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  PrivateHistoryRoundCard,
  PrivateHistorySection,
  visiblePrivateHistoryRounds,
} from "@/features/private-conversation/components";
import type { PrivateHistory } from "@/features/private-conversation/api";
import { privateHistoryKey } from "@/features/private-conversation/realtime";

const round = (
  roundNumber: number,
  askedAt: string,
  text = "Wording pinned when this was asked",
): PrivateHistory["rounds"][number] => ({
  roundNumber,
  askedAt,
  question: { text, category: "fun", intensity: "light" },
  answers: [
    { displayName: "Ari", body: "My answer" },
    { displayName: "Bo", body: "Their answer" },
  ],
  reactions: [{ displayName: "Bo", value: "heart" }],
  replies: [{ displayName: "Ari", body: "A small thought" }],
});

describe("Private history", () => {
  test("orders newest first with a stable tie-breaker and excludes the live Round", () => {
    const visible = visiblePrivateHistoryRounds(
      [
        round(1, "2026-09-22T00:00:00Z", "B"),
        round(2, "2026-09-22T00:00:00Z", "A"),
        round(3, "2026-09-20T00:00:00Z"),
      ],
      { roundNumber: 2, askedAt: "2026-09-22T00:00:00Z" },
    );
    expect(visible.map((item) => item.question.text)).toEqual([
      "B",
      "Wording pinned when this was asked",
    ]);
  });

  test("renders the historical lane, pinned wording, both answers, reactions, and replies", () => {
    const markup = renderToStaticMarkup(
      createElement(PrivateHistoryRoundCard, { round: round(1, "2026-09-22T00:00:00Z") }),
    );
    expect(markup).toContain("Fun");
    expect(markup).toContain("Wording pinned when this was asked");
    expect(markup).toContain("My answer");
    expect(markup).toContain("Their answer");
    expect(markup).toContain("Bo reacted · heart");
    expect(markup).toContain("A small thought");
  });

  test("has a quiet empty state and a restrained load-earlier control", () => {
    const emptyClient = new QueryClient();
    emptyClient.setQueryData(privateHistoryKey("pair-empty"), {
      pages: [{ rounds: [], nextCursor: undefined }],
      pageParams: [""],
    });
    const emptyMarkup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: emptyClient },
        createElement(PrivateHistorySection, { pairId: "pair-empty" }),
      ),
    );
    expect(emptyMarkup).toContain("Your revealed moments will gather here");

    const pagedClient = new QueryClient();
    pagedClient.setQueryData(privateHistoryKey("pair-paged"), {
      pages: [{ rounds: [round(1, "2026-09-20T00:00:00Z")], nextCursor: "older" }],
      pageParams: [""],
    });
    const pagedMarkup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: pagedClient },
        createElement(PrivateHistorySection, { pairId: "pair-paged" }),
      ),
    );
    expect(pagedMarkup).toContain("Load earlier moments");
  });
});
