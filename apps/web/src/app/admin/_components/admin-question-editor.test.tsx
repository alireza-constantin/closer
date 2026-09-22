import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { Window } from "happy-dom";

import { createNextNavigationMock } from "@/test/next-navigation-mock";
import { acquireDomTestLock } from "@/test/dom-test-lock";

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

const routerPush = mock(() => {});
const routerRefresh = mock(() => {});
const originalFetch = globalThis.fetch;
mock.module("next/navigation", () =>
  createNextNavigationMock({
    useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
  }),
);
mock.module("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: unknown }) =>
    createElement("a", { href, ...props }, children),
}));

const releaseImportLock = await acquireDomTestLock();
installBrowserGlobals();
const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
restoreBrowserGlobals();
releaseImportLock();
const { AdminQuestionEditor } = await import("./admin-question-editor");

const duplicate = {
  questionId: "00000000-0000-4000-8000-000000000001",
  text: "What is one thing you appreciate?",
  revisionNumber: 2,
  isActive: true,
};

let releaseTestLock: (() => void) | undefined;

beforeEach(async () => {
  releaseTestLock = await acquireDomTestLock();
  installBrowserGlobals();
});

afterEach(async () => {
  cleanup();
  await Bun.sleep(0);
  restoreBrowserGlobals();
  releaseTestLock?.();
  releaseTestLock = undefined;
  globalThis.fetch = originalFetch;
  routerPush.mockClear();
  routerRefresh.mockClear();
});

describe("Admin question authoring", () => {
  test("shows a duplicate warning without blocking intentional creation", async () => {
    globalThis.fetch = mock(async () => Response.json({ matches: [duplicate] })) as typeof fetch;

    render(createElement(AdminQuestionEditor, {}));
    const view = within(browserWindow.document.body);
    fireEvent.change(view.getByLabelText("Question wording"), {
      target: { value: "What is one thing you appreciate?" },
    });

    expect(await view.findByText("Potential duplicate found")).toBeTruthy();
    expect(view.getByText(/You can still save it if the distinction is intentional/)).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Create question" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test("explains a stale revision conflict and links to the latest history", async () => {
    globalThis.fetch = mock(async (_input, init) =>
      init?.method === "POST"
        ? Response.json({ error: "QUESTION_REVISION_CONFLICT" }, { status: 409 })
        : Response.json({ matches: [] }),
    ) as typeof fetch;

    render(
      createElement(AdminQuestionEditor, {
        questionId: duplicate.questionId,
        currentRevisionId: "00000000-0000-4000-8000-000000000002",
        currentActivity: "active",
        initialValues: {
          text: "Original wording",
          category: "fun",
          intensity: "light",
          relationshipFit: "both",
          modeFit: "both",
        },
      }),
    );
    const view = within(browserWindow.document.body);
    fireEvent.change(view.getByLabelText("Question wording"), {
      target: { value: "A revised wording for the question" },
    });
    const submit = view.getByRole("button", { name: "Save new revision" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => {
      expect(view.getByRole("alert").textContent).toContain(
        "This question changed after you opened this form",
      );
    });
    expect(view.getByRole("link", { name: "Review the latest revision" })).toBeTruthy();
  });
});
