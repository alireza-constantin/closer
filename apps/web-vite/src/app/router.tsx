import { createBrowserRouter, Navigate, redirect, type RouteObject } from "react-router";
import type { ComponentType } from "react";

import { RouteErrorPage, RoutePending } from "@/app/route-feedback";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";

function RootPage({ HomePage }: { HomePage: ComponentType }) {
  return (
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>
  );
}

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    lazy: async () => {
      const { HomePage } = await import("@/app/pages");
      return { Component: () => <RootPage HomePage={HomePage} /> };
    },
    errorElement: <RouteErrorPage />,
    HydrateFallback: RoutePending,
  },
  {
    path: "/dashboard",
    loader: () => redirect("/"),
    Component: () => <Navigate replace to="/" />,
  },
  {
    path: "/onboarding",
    lazy: async () => ({ Component: (await import("@/app/pages")).OnboardingPage }),
  },
  {
    path: "/spaces",
    lazy: async () => ({ Component: (await import("@/app/pages")).SpacesPage }),
  },
  {
    path: "/pair/:pairId",
    lazy: async () => ({ Component: (await import("@/app/pages")).PairPage }),
  },
  {
    path: "/pair/:pairId/private",
    lazy: async () => ({
      Component: (await import("@/features/private-conversation/components")).PrivateCategoryPage,
    }),
  },
  {
    path: "/pair/:pairId/private/history",
    lazy: async () => ({
      Component: (await import("@/features/private-conversation/components")).PrivateHistoryPage,
    }),
  },
  {
    path: "/pair/:pairId/private/:category",
    lazy: async () => ({
      Component: (await import("@/features/private-conversation/components"))
        .PrivateConversationPage,
    }),
  },
  {
    path: "/pair/:pairId/invite",
    lazy: async () => ({ Component: (await import("@/app/pages")).PairInvitePage }),
  },
  {
    path: "/pair/:pairId/together",
    lazy: async () => ({
      Component: (await import("@/features/together/together-pages")).TogetherPickerPage,
    }),
  },
  {
    path: "/pair/:pairId/together/sessions/:sessionId",
    lazy: async () => ({
      Component: (await import("@/features/together/together-pages")).TogetherSessionPage,
    }),
  },
  {
    path: "/invite/:token",
    lazy: async () => ({ Component: (await import("@/app/pages")).InvitePage }),
  },
  {
    path: "/rejoin/:token",
    lazy: async () => ({ Component: (await import("@/app/pages")).RejoinPage }),
  },
  {
    path: "/admin/login",
    lazy: async () => ({ Component: (await import("@/features/admin/components")).AdminLoginPage }),
  },
  {
    path: "/admin",
    lazy: async () => ({ Component: (await import("@/features/admin/components")).AdminGuard }),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import("@/features/admin/components")).AdminHomePage,
        }),
      },
      {
        path: "questions",
        lazy: async () => ({
          Component: (await import("@/features/admin/components")).AdminQuestionListPage,
        }),
      },
      {
        path: "questions/new",
        lazy: async () => ({
          Component: (await import("@/features/admin/components")).AdminNewQuestionPage,
        }),
      },
      {
        path: "questions/:questionId",
        lazy: async () => ({
          Component: (await import("@/features/admin/components")).AdminQuestionDetailPage,
        }),
      },
    ],
  },
  {
    path: "*",
    lazy: async () => ({ Component: (await import("@/app/pages")).NotFoundPage }),
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
