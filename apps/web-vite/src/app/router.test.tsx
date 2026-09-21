import { afterEach, describe, expect, test } from "bun:test";
import { createElement, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

import { RouteErrorPage, RoutePending } from "@/app/pages";
import { appRoutes } from "@/app/router";

const routers: Array<ReturnType<typeof createMemoryRouter>> = [];

afterEach(() => {
  for (const router of routers.splice(0)) {
    router.dispose();
  }
});

function renderAt(path: string): string {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  routers.push(router);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("React Router shell", () => {
  test("renders the shell at the root route", () => {
    expect(renderAt("/")).toContain("The app is getting ready.");
  });

  test("renders a useful not-found page for unknown routes", () => {
    const markup = renderAt("/unknown/deep/link");

    expect(markup).toContain("This page isn’t available.");
    expect(markup).toContain('href="/"');
  });

  test("redirects the temporary dashboard path to the root route", async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    routers.push(router);

    await router.navigate("/dashboard");

    expect(router.state.location.pathname).toBe("/");
  });

  test("uses the route error boundary instead of exposing loader errors", async () => {
    const errorRoutes: RouteObject[] = [
      {
        path: "/",
        Component: () => createElement("p", null, "home"),
      },
      {
        path: "/broken",
        loader: () => {
          throw new Error("internal implementation detail");
        },
        Component: () => createElement("p", null, "unreachable"),
        errorElement: createElement(RouteErrorPage),
        HydrateFallback: RoutePending,
      },
    ];
    const router = createMemoryRouter(errorRoutes, { initialEntries: ["/"] });
    routers.push(router);
    await router.navigate("/broken");

    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(markup).toContain("We couldn’t open this page.");
    expect(markup).not.toContain("internal implementation detail");
  });

  test("provides an accessible pending shell while a route component suspends", () => {
    function PendingRoute(): never {
      throw new Promise(() => undefined);
    }

    const markup = renderToStaticMarkup(
      createElement(
        Suspense,
        { fallback: createElement(RoutePending) },
        createElement(PendingRoute),
      ),
    );

    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading Closer…");
  });
});
