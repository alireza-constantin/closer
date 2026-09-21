import { Link, useRouteError } from "react-router";

import { PageShell } from "@/app/page-shell";

export function HomePage() {
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <p className="text-closer-muted mb-2 text-sm font-bold tracking-[.08em] uppercase">
          Closer
        </p>
        <h1 className="text-closer-navy text-4xl leading-tight font-extrabold tracking-[-.048em] text-balance">
          The app is getting ready.
        </h1>
      </section>
    </PageShell>
  );
}

export function NotFoundPage() {
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <p className="text-closer-muted mb-2 text-sm font-bold tracking-[.08em] uppercase">
          Not found
        </p>
        <h1 className="text-closer-navy text-3xl leading-tight font-extrabold tracking-[-.048em] text-balance">
          This page isn’t available.
        </h1>
        <Link className="text-closer-navy mt-5 font-semibold underline underline-offset-4" to="/">
          Go to Closer
        </Link>
      </section>
    </PageShell>
  );
}

export function RouteErrorPage() {
  useRouteError();

  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <p className="text-closer-muted mb-2 text-sm font-bold tracking-[.08em] uppercase">
          Something went wrong
        </p>
        <h1 className="text-closer-navy text-3xl leading-tight font-extrabold tracking-[-.048em] text-balance">
          We couldn’t open this page.
        </h1>
        <Link className="text-closer-navy mt-5 font-semibold underline underline-offset-4" to="/">
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
