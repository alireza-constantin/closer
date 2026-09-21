import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { Window } from "happy-dom";

const browserWindow = new Window({ url: "https://closer.test" });
const browserGlobalNames = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const originalBrowserGlobals = new Map(
  browserGlobalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);

function installBrowserGlobals() {
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Node: browserWindow.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: browserWindow.navigator,
  });
}

function restoreBrowserGlobals() {
  for (const name of browserGlobalNames) {
    const descriptor = originalBrowserGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}

mock.module("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children),
}));

installBrowserGlobals();
const { cleanup, render, screen } = await import("@testing-library/react");
restoreBrowserGlobals();
const { getMostUrgentQuestionCoverage, QuestionCoverageSummary, QuestionCoverageWorkspace } =
  await import("./admin-question-coverage");

type QuestionCoverageLane = Parameters<typeof getMostUrgentQuestionCoverage>[0][number];

function lane(
  category: QuestionCoverageLane["category"],
  relationship: QuestionCoverageLane["relationship"],
  mode: QuestionCoverageLane["mode"],
  level: QuestionCoverageLane["level"],
  eligibleQuestions: number,
): QuestionCoverageLane {
  return {
    category,
    relationship,
    mode,
    level,
    eligibleQuestions,
    intensityBreakdown: { light: 0, medium: 0, deep: eligibleQuestions },
  };
}

beforeEach(installBrowserGlobals);

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

describe("Admin question coverage", () => {
  test("uses human copy and separates category from intensity", () => {
    render(
      createElement(QuestionCoverageSummary, {
        lanes: [lane("deep", "partner", "private", "critical", 2)],
      }),
    );

    expect(screen.getByRole("heading", { name: "Question coverage" })).toBeTruthy();
    expect(
      screen.getByText("Make sure every conversation type has enough questions."),
    ).toBeTruthy();
    expect(screen.queryByText("Inventory lanes needing attention")).toBeNull();
    expect(document.body.textContent).not.toContain("diagnostic");
    expect(screen.getByLabelText("Category: Deep")).toBeTruthy();
    expect(document.body.textContent).toContain("Intensity: Light 0 · Medium 0 · Deep 2");
  });

  test("shows at most five urgent lanes in severity, count, and stable catalog order", () => {
    const lanes = [
      lane("memories", "friend", "together", "low", 0),
      lane("deep", "partner", "private", "critical", 5),
      lane("fun", "friend", "private", "critical", 2),
      lane("fun", "partner", "together", "critical", 2),
      lane("fun", "partner", "private", "critical", 2),
      lane("friendship", "friend", "together", "low", 1),
      lane("relationship", "partner", "private", "healthy", 12),
    ];

    render(createElement(QuestionCoverageSummary, { lanes }));

    const rows = screen.getByRole("list", { name: "Most urgent question coverage gaps" }).children;
    expect(rows).toHaveLength(5);
    expect(Array.from(rows, (row) => row.textContent)).toEqual([
      expect.stringContaining("2 questions available"),
      expect.stringContaining("2 questions available"),
      expect.stringContaining("2 questions available"),
      expect.stringContaining("5 questions available"),
      expect.stringContaining("0 questions available"),
    ]);
    expect(Array.from(rows, (row) => row.textContent?.match(/Critical|Low/)?.[0])).toEqual([
      "Critical",
      "Critical",
      "Critical",
      "Critical",
      "Low",
    ]);
    expect(rows[0]?.textContent).toContain("Partner · Private");
    expect(rows[1]?.textContent).toContain("Partner · Together");
    expect(rows[2]?.textContent).toContain("Friend · Private");
  });

  test("links to the complete coverage view, including healthy lanes", () => {
    const lanes = [
      lane("fun", "partner", "private", "critical", 2),
      lane("deep", "friend", "together", "low", 8),
      lane("friendship", "friend", "private", "healthy", 12),
    ];

    render(createElement(QuestionCoverageSummary, { lanes }));

    expect(screen.getByRole("link", { name: "View all coverage" }).getAttribute("href")).toBe(
      "/admin/questions?coverage=all",
    );

    cleanup();
    render(createElement(QuestionCoverageWorkspace, { lanes }));

    expect(screen.getByRole("list", { name: "Complete question coverage" }).children).toHaveLength(
      lanes.length,
    );
    expect(screen.getByText("Healthy")).toBeTruthy();
  });

  test("uses category, relationship, and mode order for full coverage ties", () => {
    const lanes = [
      lane("deep", "partner", "private", "critical", 2),
      lane("fun", "friend", "together", "critical", 2),
      lane("fun", "partner", "together", "critical", 2),
      lane("fun", "friend", "private", "critical", 2),
      lane("fun", "partner", "private", "critical", 2),
    ];

    render(createElement(QuestionCoverageWorkspace, { lanes }));

    const rows = Array.from(
      screen.getByRole("list", { name: "Complete question coverage" }).children,
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      expect.stringMatching(/FunPartner · Private/),
      expect.stringMatching(/FunPartner · Together/),
      expect.stringMatching(/FunFriend · Private/),
      expect.stringMatching(/FunFriend · Together/),
      expect.stringMatching(/DeepPartner · Private/),
    ]);
  });

  test("shows a calm healthy state when there are no urgent lanes", () => {
    render(createElement(QuestionCoverageSummary, { lanes: [] }));

    expect(screen.getByRole("status").textContent).toContain("Coverage looks healthy");
    expect(screen.getByRole("status").textContent).toContain(
      "Every conversation type currently has enough eligible questions.",
    );
    expect(screen.queryByRole("list", { name: "Most urgent question coverage gaps" })).toBeNull();
  });
});
