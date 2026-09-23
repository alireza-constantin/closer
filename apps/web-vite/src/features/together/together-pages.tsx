import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageShell } from "@/app/page-shell";
import { EndedPairPage } from "@/features/pair/components";
import { connectPairRealtime, pairQueryKey } from "@/features/pair/realtime";
import {
  advanceTogetherSession,
  endTogetherSession,
  getPair,
  getTogetherPlayback,
  likeTogetherQuestion,
  startTogetherSession,
  type TogetherPlayback,
} from "@/features/consumer/api";

function ErrorState({ message = "We couldn’t open Together." }: { message?: string }) {
  return (
    <div className="bg-closer-peach/70 mt-8 rounded-3xl p-5" role="alert">
      <p className="text-closer-navy font-extrabold">{message}</p>
      <p className="text-closer-muted mt-2 text-sm">Try again when you’re ready.</p>
    </div>
  );
}

const categories = [
  { id: "fun", label: "Fun", tone: "bg-closer-yellow/60" },
  { id: "deep", label: "Deep", tone: "bg-closer-blue/30" },
  { id: "memories", label: "Memories", tone: "bg-closer-mint/60" },
  {
    id: "relationship",
    label: "Relationship",
    tone: "bg-closer-lavender/60",
    relationship: "partner",
  },
  { id: "friendship", label: "Friendship", tone: "bg-closer-peach/70", relationship: "friend" },
];

export function TogetherPickerPage() {
  const { pairId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pair = useQuery({
    queryKey: pairQueryKey(pairId),
    queryFn: () => getPair(pairId),
    enabled: Boolean(pairId),
    retry: false,
    refetchOnMount: "always",
  });
  React.useEffect(() => {
    if (!pairId || !pair.data || pair.data.state === "terminated") return;
    return connectPairRealtime(pairId, queryClient);
  }, [pair.data?.state, pairId, queryClient]);
  const start = useMutation({
    mutationFn: (category: string) => startTogetherSession(pairId, category),
    onSuccess: (value) => navigate(`/pair/${pairId}/together/sessions/${value.sessionId}`),
  });
  const allowed = categories.filter(
    (category) =>
      !category.relationship || category.relationship === (pair.data?.relationshipType ?? ""),
  );
  if (pair.data?.state === "terminated") return <EndedPairPage pairId={pairId} />;
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted text-sm font-bold" to={`/pair/${pairId}`}>
          ← Back to space
        </Link>
        <p className="text-closer-coral mt-10 text-sm font-bold uppercase">Together</p>
        <h1 className="text-closer-navy mt-2 text-5xl font-extrabold tracking-[-.06em]">
          A little closer.
        </h1>
        <p className="text-closer-muted mt-4 max-w-sm leading-7">
          Pick a feeling and take turns with one shared question at a time.
        </p>
        {(pair.isPending || pair.isFetching) && (
          <p className="text-closer-muted mt-8">Checking your space…</p>
        )}
        {pair.error && <ErrorState message="We couldn’t check this space." />}
        {pair.isSuccess && !pair.isFetching && (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {allowed.map((category) => (
              <button
                className={`${category.tone} text-closer-navy rounded-3xl p-5 text-left transition hover:-translate-y-0.5 disabled:opacity-60`}
                disabled={start.isPending}
                key={category.id}
                onClick={() => start.mutate(category.id)}
              >
                <span className="block text-lg font-extrabold">{category.label}</span>
                <span className="text-closer-muted mt-1 block text-sm">Start a shared moment.</span>
              </button>
            ))}
          </div>
        )}
        {start.isPending && (
          <p className="text-closer-muted mt-5" aria-live="polite">
            Finding the first question…
          </p>
        )}
        {start.error && <ErrorState message="There aren’t any questions here yet." />}
      </section>
    </PageShell>
  );
}

export function TogetherSessionPage() {
  const { pairId = "", sessionId = "" } = useParams();
  const queryClient = useQueryClient();
  const pair = useQuery({
    queryKey: pairQueryKey(pairId),
    queryFn: () => getPair(pairId),
    enabled: Boolean(pairId),
    retry: false,
    refetchOnMount: "always",
  });
  React.useEffect(() => {
    if (!pairId || !pair.data || pair.data.state === "terminated") return;
    return connectPairRealtime(pairId, queryClient);
  }, [pair.data?.state, pairId, queryClient]);
  const session = useQuery({
    queryKey: ["together", pairId, sessionId],
    queryFn: () => getTogetherPlayback(pairId, sessionId),
    enabled:
      Boolean(pairId && sessionId) &&
      pair.isSuccess &&
      !pair.isFetching &&
      pair.data.state !== "terminated",
  });
  const [busy, setBusy] = React.useState(false);
  const reconcile = () =>
    queryClient.invalidateQueries({ queryKey: ["together", pairId, sessionId] });

  async function act(action: "next" | "skip") {
    if (!session.data?.question || busy) return;
    setBusy(true);
    try {
      await advanceTogetherSession(pairId, sessionId, action, session.data.question.questionId);
      await reconcile();
    } catch {
      await reconcile();
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike() {
    if (!session.data?.question || busy) return;
    setBusy(true);
    try {
      await likeTogetherQuestion(
        pairId,
        sessionId,
        !session.data.question.liked,
        session.data.question.questionId,
      );
      await reconcile();
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      await endTogetherSession(pairId, sessionId);
      await reconcile();
    } finally {
      setBusy(false);
    }
  }

  const data = session.data as TogetherPlayback | undefined;
  if (pair.data?.state === "terminated") return <EndedPairPage pairId={pairId} />;
  if (!pair.isSuccess || pair.isFetching) {
    return (
      <PageShell>
        <section className="flex flex-1 flex-col py-8">
          {pair.error ? (
            <ErrorState message="We couldn’t check this space." />
          ) : (
            <p className="text-closer-muted mt-8">Checking your space…</p>
          )}
        </section>
      </PageShell>
    );
  }
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <div className="flex items-center justify-between gap-3">
          <Link className="text-closer-muted text-sm font-bold" to={`/pair/${pairId}/together`}>
            ← Choose another feeling
          </Link>
          <span className="text-closer-muted text-xs font-bold uppercase">
            {data?.category ?? "Together"}
          </span>
        </div>
        {session.isPending && (
          <div
            className="bg-closer-surface border-closer-line mt-10 animate-pulse rounded-[2rem] border p-7"
            aria-label="Loading Together"
          />
        )}
        {session.error && <ErrorState />}
        {data && data.endedAt && (
          <div className="my-auto py-12 text-center">
            <p className="text-closer-coral text-sm font-bold uppercase">Moment complete</p>
            <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
              That was a good one.
            </h1>
            <p className="text-closer-muted mt-4 leading-7">
              Your Together moment is saved. Start another whenever you’re ready.
            </p>
            <Link
              className="bg-closer-coral text-closer-navy mt-7 inline-block rounded-2xl px-5 py-4 font-extrabold"
              to={`/pair/${pairId}/together`}
            >
              Start another
            </Link>
          </div>
        )}
        {data && !data.endedAt && !data.question && (
          <div className="my-auto py-12 text-center">
            <p className="text-closer-coral text-sm font-bold uppercase">
              {data.endedAt ? "Moment complete" : "For now"}
            </p>
            <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
              You’ve reached the end for now.
            </h1>
            <p className="text-closer-muted mt-4 leading-7">
              There’s nothing else to show in this moment. You can start a fresh one whenever you
              like.
            </p>
            <Link
              className="bg-closer-coral text-closer-navy mt-7 inline-block rounded-2xl px-5 py-4 font-extrabold"
              to={`/pair/${pairId}/together`}
            >
              Start another
            </Link>
          </div>
        )}
        {data?.question && !data.endedAt && (
          <div className="my-auto">
            <p className="text-closer-muted text-sm font-bold">Question {data.question.position}</p>
            <article className="bg-closer-surface border-closer-line mt-3 rounded-[2rem] border p-7 shadow-[0_18px_50px_rgba(35,47,74,.08)]">
              <p className="text-closer-navy text-[2rem] leading-[1.08] font-extrabold tracking-[-.045em]">
                {data.question.text}
              </p>
              <button
                className="text-closer-coral mt-8 text-sm font-extrabold"
                disabled={busy || Boolean(data.endedAt)}
                onClick={toggleLike}
              >
                {data.question.liked ? "♥ Liked" : "♡ Like this one"}
              </button>
            </article>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="bg-closer-peach text-closer-navy rounded-2xl px-4 py-4 font-extrabold disabled:opacity-50"
                disabled={busy || Boolean(data.endedAt)}
                onClick={() => act("skip")}
              >
                Skip
              </button>
              <button
                className="bg-closer-coral text-closer-navy rounded-2xl px-4 py-4 font-extrabold disabled:opacity-50"
                disabled={busy || Boolean(data.endedAt)}
                onClick={() => act("next")}
              >
                Next question
              </button>
            </div>
            <button
              className="text-closer-muted mt-6 w-full text-sm font-semibold underline"
              disabled={busy || Boolean(data.endedAt)}
              onClick={end}
            >
              End this moment
            </button>
          </div>
        )}
      </section>
    </PageShell>
  );
}
