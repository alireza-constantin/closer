import { createBrowserRouter, Navigate, redirect, type RouteObject } from "react-router";

import { HomePage, NotFoundPage, RouteErrorPage, RoutePending } from "@/app/pages";

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    Component: HomePage,
    errorElement: <RouteErrorPage />,
    HydrateFallback: RoutePending,
  },
  {
    path: "/dashboard",
    loader: () => redirect("/"),
    Component: () => <Navigate replace to="/" />,
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
