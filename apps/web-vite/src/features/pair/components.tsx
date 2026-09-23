import { Link } from "react-router";

import { PageShell } from "@/app/page-shell";

export function EndedPairPage({ pairId }: { pairId: string }) {
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted text-sm font-bold" to="/spaces">
          ← All spaces
        </Link>
        <div className="bg-closer-surface border-closer-line shadow-closer-soft mt-10 rounded-[2rem] border p-7 sm:p-9">
          <p className="text-closer-coral text-sm font-bold uppercase">Space ended</p>
          <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.055em]">
            This space has ended.
          </h1>
          <p className="text-closer-muted mt-4 max-w-lg leading-7">
            Conversations and Together moments can’t continue here. Invitations and rejoin links no
            longer work. Your existing history is kept read-only; starting again creates a new
            space.
          </p>
          <Link
            className="bg-closer-lavender/60 text-closer-navy mt-7 inline-flex rounded-2xl px-5 py-4 font-extrabold"
            to={`/pair/${encodeURIComponent(pairId)}/private/history`}
          >
            View shared history
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
