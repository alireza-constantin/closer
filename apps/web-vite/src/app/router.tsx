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
import { TogetherPickerPage, TogetherSessionPage } from "@/features/together/together-pages";
import {
  PrivateCategoryPage,
  PrivateConversationPage,
  PrivateHistoryPage,
} from "@/features/private-conversation/components";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AdminGuard,
  AdminHomePage,
  AdminLoginPage,
  AdminNewQuestionPage,
  AdminQuestionDetailPage,
  AdminQuestionListPage,
} from "@/features/admin/components";

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
  { path: "/pair/:pairId/private", Component: PrivateCategoryPage },
  { path: "/pair/:pairId/private/history", Component: PrivateHistoryPage },
  { path: "/pair/:pairId/private/:category", Component: PrivateConversationPage },
  { path: "/pair/:pairId/invite", Component: PairInvitePage },
  { path: "/pair/:pairId/together", Component: TogetherPickerPage },
  { path: "/pair/:pairId/together/sessions/:sessionId", Component: TogetherSessionPage },
  { path: "/invite/:token", Component: InvitePage },
  { path: "/rejoin/:token", Component: RejoinPage },
  { path: "/admin/login", Component: AdminLoginPage },
  {
    path: "/admin",
    Component: AdminGuard,
    children: [
      { index: true, Component: AdminHomePage },
      { path: "questions", Component: AdminQuestionListPage },
      { path: "questions/new", Component: AdminNewQuestionPage },
      { path: "questions/:questionId", Component: AdminQuestionDetailPage },
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
