import { Suspense } from "react";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/providers";
import { createAppRouter } from "@/app/router";
import { RoutePending } from "@/app/route-feedback";

const router = createAppRouter();

export function App() {
  return (
    <AppProviders>
      <Suspense fallback={<RoutePending />}>
        <RouterProvider router={router} />
      </Suspense>
    </AppProviders>
  );
}
