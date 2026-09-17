import { describe, expect, test } from "bun:test";

import {
  chooseBufferedTogetherQuestion,
  shouldPrefetchTogetherQuestionPage,
  type TogetherQuestionPage,
} from "@Closer/db/together-playback";

const question = (questionId: string) => ({
  questionId,
  questionRevisionId: `revision-${questionId}`,
  text: `Question ${questionId}`,
});

const page = (items: ReturnType<typeof question>[], hasMore = false): TogetherQuestionPage => ({
  items,
  hasMore,
  nextCursor: hasMore ? "next-page" : null,
});

describe("Together loaded-question playback", () => {
  test("uses the documented light, medium, and deep fallback orders from already-loaded pages", () => {
    const pools = {
      light: page([]),
      medium: page([question("medium")]),
      deep: page([question("deep")]),
    };

    expect(chooseBufferedTogetherQuestion(pools, 0)).toMatchObject({ kind: "question", band: "medium", question: { questionId: "medium" } });
    expect(chooseBufferedTogetherQuestion({ ...pools, medium: page([]), light: page([question("light")]) }, 2)).toMatchObject({ kind: "question", band: "light", question: { questionId: "light" } });
    expect(chooseBufferedTogetherQuestion({ ...pools, light: page([]), medium: page([question("medium")]), deep: page([]) }, 4)).toMatchObject({ kind: "question", band: "medium", question: { questionId: "medium" } });
  });

  test("does not treat an empty local buffer with another server page as exhaustion", () => {
    const pools = {
      light: page([], true),
      medium: page([question("medium")]),
      deep: page([question("deep")]),
    };

    expect(chooseBufferedTogetherQuestion(pools, 0)).toEqual({ kind: "loading", band: "light" });
    expect(chooseBufferedTogetherQuestion({ ...pools, light: page([]) }, 0)).toMatchObject({ kind: "question", band: "medium" });
  });

  test("only reports exhaustion once every applicable local buffer is empty and has no next page", () => {
    const pools = { light: page([]), medium: page([]), deep: page([]) };

    expect(chooseBufferedTogetherQuestion(pools, 4)).toEqual({ kind: "exhausted" });
  });

  test("prefetches at the five-question threshold and never after the last page", () => {
    expect(shouldPrefetchTogetherQuestionPage(page(Array.from({ length: 5 }, (_, index) => question(`${index}`)), true))).toBe(true);
    expect(shouldPrefetchTogetherQuestionPage(page(Array.from({ length: 6 }, (_, index) => question(`${index}`)), true))).toBe(false);
    expect(shouldPrefetchTogetherQuestionPage(page([], false))).toBe(false);
  });
});
