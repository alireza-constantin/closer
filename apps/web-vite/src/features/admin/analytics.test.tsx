import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { adminSessionKey } from "@/features/admin/api";
import { AdminGuard } from "@/features/admin/components";
import {
  adminCoverageKey,
  adminQuestionAnalyticsKey,
  getAdminCoverage,
  getAdminQuestionAnalytics,
} from "@/features/admin/analytics-api";
import {
  AdminCoverageOverview,
  AnalyticsErrorState,
  AnalyticsLoadingState,
  AnalyticsMetricGroup,
  CoverageGrid,
  invalidateCoverage,
  invalidateQuestionAnalytics,
  QuestionAnalyticsPanel,
} from "@/features/admin/analytics";

const originalFetch = globalThis.fetch;
const queryClients: QueryClient[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
});

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(client);
  return client;
}

function renderWithClient(node: React.ReactNode, client = createClient()) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

const availablePrivate = {
  status: "available" as const,
  validOffers: 25,
  decisions: 12,
  decisionRate: { status: "available" as const, numerator: 12, denominator: 25, rate: 0.48 },
  askRate: { status: "available" as const, numerator: 8, denominator: 12, rate: 2 / 3 },
  skipRate: { status: "available" as const, numerator: 4, denominator: 12, rate: 1 / 3 },
  likeRate: { status: "available" as const, numerator: 3, denominator: 12, rate: 0.25 },
};

const availableTogether = {
  status: "available" as const,
  shown: 20,
  decisions: 16,
  continueRate: { status: "available" as const, numerator: 11, denominator: 16, rate: 11 / 16 },
  skipRate: { status: "available" as const, numerator: 5, denominator: 16, rate: 5 / 16 },
  likeRate: { status: "unavailable" as const },
};

const question = {
  id: "question-1",
  currentRevisionId: "revision-2",
  isActive: true,
  current: {
    id: "revision-2",
    questionId: "question-1",
    revisionNumber: 2,
    text: "What helped you feel close this week?",
    category: "deep" as const,
    relationshipFit: "both" as const,
    modeFit: "both" as const,
    intensity: "medium" as const,
    withdrawn: false,
  },
};

const revisions = [
  question.current,
  { ...question.current, id: "revision-1", revisionNumber: 1, text: "Earlier wording" },
];

describe("Admin analytics presentation", () => {
  test("shows backend Private rates and approved numerator and denominator", () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsMetricGroup, { title: "Private", value: availablePrivate }),
    );

    expect(markup).toContain("Decision rate");
    expect(markup).toContain("48%");
    expect(markup).toContain("12 / 25");
    expect(markup).toContain("Ask rate");
    expect(markup).toContain("Like rate");
  });

  test("shows Together continuation and neutral unavailable rates", () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsMetricGroup, { title: "Together", value: availableTogether }),
    );

    expect(markup).toContain("Continue rate");
    expect(markup).toContain("68.8%");
    expect(markup).toContain("11 / 16");
    expect(markup).toContain("Unavailable");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  test("suppresses every operand when the backend reports insufficient data", () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsMetricGroup, {
        title: "Private",
        value: { status: "insufficient_data" },
      }),
    );

    expect(markup).toContain("Insufficient data");
    expect(markup).not.toContain("0%");
    expect(markup).not.toContain("25");
    expect(markup).not.toContain(" / ");
  });

  test("renders category lanes with backend coverage bands and readable labels", () => {
    const markup = renderToStaticMarkup(
      createElement(CoverageGrid, {
        items: [
          {
            category: "fun",
            relationshipType: "partner",
            mode: "private",
            eligible: 2,
            health: "critical",
            intensity: { light: 1, medium: 1, deep: 0 },
          },
          {
            category: "deep",
            relationshipType: "friend",
            mode: "together",
            eligible: 8,
            health: "low",
            intensity: { light: 0, medium: 3, deep: 5 },
          },
          {
            category: "memories",
            relationshipType: "partner",
            mode: "together",
            eligible: 14,
            health: "healthy",
            intensity: { light: 6, medium: 5, deep: 3 },
          },
        ],
      }),
    );

    expect(markup).toContain("Critical");
    expect(markup).toContain("Low");
    expect(markup).toContain("Healthy");
    expect(markup).toContain("Fun");
    expect(markup).toContain("Deep");
    expect(markup).toContain("Memories");
    expect(markup).toContain("usable Questions");
    expect(markup).toContain("Intensity mix");
  });

  test("labels current and selected historical revisions explicitly", () => {
    const currentClient = createClient();
    currentClient.setQueryData(
      adminQuestionAnalyticsKey(question.id, { revisionScope: "current" }),
      {
        questionId: question.id,
        revisionScope: "current",
        selectedRevisionId: "revision-2",
        selectedRevisionNumber: 2,
        private: { status: "insufficient_data" },
        together: { status: "insufficient_data" },
      },
    );
    const currentRouter = createMemoryRouter(
      [
        {
          path: "/admin/questions/:questionId",
          Component: () => createElement(QuestionAnalyticsPanel, { question, revisions }),
        },
      ],
      { initialEntries: ["/admin/questions/question-1"] },
    );
    const currentMarkup = renderWithClient(
      createElement(RouterProvider, { router: currentRouter }),
      currentClient,
    );
    currentRouter.dispose();

    const historicalClient = createClient();
    historicalClient.setQueryData(
      adminQuestionAnalyticsKey(question.id, {
        revisionScope: "revision",
        revisionId: "revision-1",
      }),
      {
        questionId: question.id,
        revisionScope: "revision",
        selectedRevisionId: "revision-1",
        selectedRevisionNumber: 1,
        private: { status: "insufficient_data" },
        together: { status: "insufficient_data" },
      },
    );
    const historicalRouter = createMemoryRouter(
      [
        {
          path: "/admin/questions/:questionId",
          Component: () => createElement(QuestionAnalyticsPanel, { question, revisions }),
        },
      ],
      { initialEntries: ["/admin/questions/question-1?analyticsRevision=revision-1"] },
    );
    const historicalMarkup = renderWithClient(
      createElement(RouterProvider, { router: historicalRouter }),
      historicalClient,
    );
    historicalRouter.dispose();

    expect(currentMarkup).toContain("Current revision v2");
    expect(historicalMarkup).toContain("Revision v1 — historical");
    expect(historicalMarkup).toContain('value="revision-1" selected=""');
  });

  test("exposes coherent loading and safe error states", () => {
    const loading = renderToStaticMarkup(
      createElement(AnalyticsLoadingState, null, "Loading Question analytics…"),
    );
    const error = renderToStaticMarkup(
      createElement(AnalyticsErrorState, { error: new Error("secret response body") }),
    );

    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading Question analytics");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Analytics could not be loaded");
    expect(error).not.toContain("secret response body");
  });

  test("keeps coverage loading visible while the request is pending", () => {
    const markup = renderWithClient(createElement(AdminCoverageOverview));
    expect(markup).toContain("Loading Question coverage");
  });

  test("question edits invalidate analytics and coverage queries", async () => {
    const client = createClient();
    const questionKey = adminQuestionAnalyticsKey(question.id, { revisionScope: "current" });
    client.setQueryData(questionKey, { private: availablePrivate, together: availableTogether });
    client.setQueryData(adminCoverageKey, { items: [] });
    expect(client.getQueryCache().find({ queryKey: questionKey })?.state.isInvalidated).toBe(false);
    expect(client.getQueryCache().find({ queryKey: adminCoverageKey })?.state.isInvalidated).toBe(
      false,
    );

    await invalidateQuestionAnalytics(client, question.id);
    await invalidateCoverage(client);

    expect(client.getQueryCache().find({ queryKey: questionKey })?.state.isInvalidated).toBe(true);
    expect(client.getQueryCache().find({ queryKey: adminCoverageKey })?.state.isInvalidated).toBe(
      true,
    );
  });

  test("keeps analytics behind the Admin guard for consumer accounts", () => {
    const client = createClient();
    client.setQueryData(adminSessionKey, { actor: { authUserId: "user-1", kind: "registered" } });
    const router = createMemoryRouter(
      [
        {
          path: "/admin",
          Component: AdminGuard,
          children: [
            { index: true, Component: () => createElement("p", null, "Private analytics") },
          ],
        },
      ],
      { initialEntries: ["/admin"] },
    );
    const markup = renderWithClient(createElement(RouterProvider, { router }), client);
    router.dispose();

    expect(markup).toContain("Admin access required");
    expect(markup).not.toContain("Private analytics");
  });
});

describe("Admin analytics API contract", () => {
  test("loads the current revision by default and explicitly requests historical scopes", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      const url = new URL(String(input), "http://closer.test");
      const revisionScope = url.searchParams.get("revisionScope") ?? "current";
      const selectedRevisionId =
        revisionScope === "all" ? null : revisionScope === "revision" ? "revision-1" : "revision-2";
      return Response.json({
        questionId: "question-1",
        revisionScope,
        selectedRevisionId,
        selectedRevisionNumber:
          selectedRevisionId === "revision-2" ? 2 : selectedRevisionId ? 1 : null,
        private: { status: "insufficient_data" },
        together: { status: "insufficient_data" },
      });
    }) as typeof fetch;

    await getAdminQuestionAnalytics("question-1", { revisionScope: "current" });
    await getAdminQuestionAnalytics("question-1", { revisionScope: "all" });
    await getAdminQuestionAnalytics("question-1", {
      revisionScope: "revision",
      revisionId: "revision-1",
    });

    expect(requests[0]).toContain("revisionScope=current");
    expect(requests[0]).toContain("question-1/analytics");
    expect(requests[1]).toContain("revisionScope=all");
    expect(requests[2]).toContain("revisionScope=revision");
    expect(requests[2]).toContain("revisionId=revision-1");
  });

  test("rejects suppressed analytics responses that carry private operands", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        questionId: "question-1",
        revisionScope: "current",
        selectedRevisionId: "revision-2",
        selectedRevisionNumber: 2,
        private: { status: "insufficient_data", decisions: 4, numerator: 2 },
        together: { status: "insufficient_data" },
      })) as unknown as typeof fetch;

    await expect(
      getAdminQuestionAnalytics("question-1", { revisionScope: "current" }),
    ).rejects.toThrow();
  });

  test("loads coverage only from its protected API endpoint", async () => {
    let request = "";
    globalThis.fetch = (async (input) => {
      request = String(input);
      return Response.json({ items: [] });
    }) as typeof fetch;

    await expect(getAdminCoverage()).resolves.toEqual({ items: [] });
    expect(request).toContain("/api/v1/admin/analytics/coverage");
  });
});
