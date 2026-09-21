import { afterEach, describe, expect, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppProviders } from "@/app/providers";
import { createQueryClient, queryClient } from "@/lib/query-client";

afterEach(() => {
  queryClient.clear();
});

describe("QueryClient setup", () => {
  test("creates a central client with the current Closer query defaults", () => {
    const client = createQueryClient();

    expect(client.getDefaultOptions().queries).toMatchObject({
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: 2,
    });
    expect(client).not.toBe(queryClient);
  });

  test("provides the single app QueryClient through its provider", () => {
    function QueryClientProbe() {
      return createElement(
        "output",
        null,
        useQueryClient() === queryClient ? "connected" : "missing",
      );
    }

    const markup = renderToStaticMarkup(
      createElement(AppProviders, null, createElement(QueryClientProbe)),
    );

    expect(markup).toContain("connected");
  });
});
