import { Link, useRouteError } from "react-router";

import { PageShell } from "@/app/page-shell";

export function RouteErrorPage() {
  useRouteError();
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <h1 className="text-closer-navy text-3xl font-extrabold">We couldn’t open this page.</h1>
        <Link className="text-closer-navy mt-5 font-semibold underline" to="/">
          Return to Closer
        </Link>
      </section>
    </PageShell>
  );
}

export function RoutePending() {
  return (
    <main aria-live="polite" className="text-closer-muted grid min-h-svh place-items-center">
      <p>Loading Closer…</p>
    </main>
  );
}
