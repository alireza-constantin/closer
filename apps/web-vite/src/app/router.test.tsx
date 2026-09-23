import { afterEach, describe, expect, test } from "bun:test";
import { createElement, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

import { RouteErrorPage, RoutePending } from "@/app/route-feedback";
import { appRoutes } from "@/app/router";

const routers: Array<ReturnType<typeof createMemoryRouter>> = [];

afterEach(() => {
  for (const router of routers.splice(0)) {
    router.dispose();
  }
});

async function renderAt(path: string): Promise<string> {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  routers.push(router);
  await router.navigate(path);
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("React Router shell", () => {
  test("renders the shell at the root route", async () => {
    expect(await renderAt("/")).toContain("The app is getting ready.");
  });

  test("renders a useful not-found page for unknown routes", async () => {
    const markup = await renderAt("/unknown/deep/link");

    expect(markup).toContain("This page isn’t available.");
    expect(markup).toContain('href="/"');
  });

  test("resolves lazy consumer, Private, Together, and Admin route modules", async () => {
    const paths = [
      "/onboarding",
      "/spaces",
      "/pair/test-pair",
      "/pair/test-pair/private",
      "/pair/test-pair/private/history",
      "/pair/test-pair/private/fun",
      "/pair/test-pair/together",
      "/pair/test-pair/together/sessions/test-session",
      "/admin/login",
      "/admin/questions",
    ];

    for (const path of paths) {
      const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
      routers.push(router);
      await router.navigate(path);
      expect(router.state.errors, `${path} should resolve without a route error`).toBeNull();
    }
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
