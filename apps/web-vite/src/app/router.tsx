import { createBrowserRouter, Navigate, redirect, type RouteObject } from "react-router";

import {
  HomePage,
  InvitePage,
  NotFoundPage,
  OnboardingPage,
  PairInvitePage,
  PairPage,
  RejoinPage,
  RouteErrorPage,
  RoutePending,
  SpacesPage,
} from "@/app/pages";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";

function RootPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>
  );
}

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    Component: RootPage,
    errorElement: <RouteErrorPage />,
    HydrateFallback: RoutePending,
  },
  {
    path: "/dashboard",
    loader: () => redirect("/"),
    Component: () => <Navigate replace to="/" />,
  },
  { path: "/onboarding", Component: OnboardingPage },
  { path: "/spaces", Component: SpacesPage },
  { path: "/pair/:pairId", Component: PairPage },
  { path: "/pair/:pairId/invite", Component: PairInvitePage },
  { path: "/invite/:token", Component: InvitePage },
  { path: "/rejoin/:token", Component: RejoinPage },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
