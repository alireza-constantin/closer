import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { EndedPairPage } from "@/features/pair/components";

describe("Ended Pair page", () => {
  test("explains the read-only state and links to retained history", () => {
    const router = createMemoryRouter(
      [{ path: "/", Component: () => createElement(EndedPairPage, { pairId: "pair-1" }) }],
      { initialEntries: ["/"] },
    );
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    router.dispose();

    expect(markup).toContain("This space has ended.");
    expect(markup).toContain("Your existing history is kept read-only");
    expect(markup).toContain('href="/pair/pair-1/private/history"');
    expect(markup).not.toContain("Invite your person");
    expect(markup).not.toContain("Start a shared moment");
  });
});
