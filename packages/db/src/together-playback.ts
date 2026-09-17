export const TOGETHER_QUESTION_PAGE_SIZE = 20;
export const TOGETHER_PREFETCH_REMAINING_THRESHOLD = 5;

export const togetherQuestionBands = ["light", "medium", "deep"] as const;

export type TogetherQuestionBand = (typeof togetherQuestionBands)[number];

export type TogetherLoadedQuestion = {
  questionId: string;
  questionRevisionId: string;
  text: string;
};

export type TogetherQuestionPage = {
  items: TogetherLoadedQuestion[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type TogetherQuestionPools = Record<TogetherQuestionBand, TogetherQuestionPage>;

export function togetherIntensityFallback(completedNextTransitions: number): TogetherQuestionBand[] {
  if (completedNextTransitions >= 4) return ["deep", "medium", "light"];
  if (completedNextTransitions >= 2) return ["medium", "light", "deep"];
  return ["light", "medium", "deep"];
}

export function chooseBufferedTogetherQuestion(pools: TogetherQuestionPools, completedNextTransitions: number):
  | { kind: "question"; band: TogetherQuestionBand; question: TogetherLoadedQuestion }
  | { kind: "loading"; band: TogetherQuestionBand }
  | { kind: "exhausted" } {
  for (const band of togetherIntensityFallback(completedNextTransitions)) {
    const page = pools[band];
    const question = page.items[0];
    if (question) return { kind: "question", band, question };
    if (page.hasMore) return { kind: "loading", band };
  }
  return { kind: "exhausted" };
}

export function shouldPrefetchTogetherQuestionPage(page: TogetherQuestionPage) {
  return page.hasMore && page.items.length <= TOGETHER_PREFETCH_REMAINING_THRESHOLD;
}
