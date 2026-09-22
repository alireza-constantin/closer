import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

import { PageShell } from "@/app/page-shell";
import { ApiError } from "@/lib/api-client";
import {
  askPrivateCandidate,
  getPrivateConversation,
  likePrivateCandidate,
  privateCategories,
  skipPrivateCandidate,
  startPrivateConversation,
} from "@/features/private-conversation/api";
import {
  connectPrivateRealtime,
  privateConversationKey,
} from "@/features/private-conversation/realtime";

const categoryLabel: Record<string, string> = {
  fun: "Fun",
  deep: "Deep",
  memories: "Memories",
  relationship: "Relationship",
  friendship: "Friendship",
};

export function PrivateCategoryPage() {
  const { pairId = "" } = useParams();
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted text-sm font-bold" to={`/pair/${pairId}`}>
          ← Back to space
        </Link>
        <p className="text-closer-coral mt-10 text-sm font-bold uppercase">Private</p>
        <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
          Choose a conversation lane.
        </h1>
        <div className="mt-8 grid gap-3">
          {privateCategories.map((category) => (
            <Link
              className="bg-closer-surface border-closer-line rounded-3xl border p-5 transition hover:-translate-y-0.5"
              key={category}
              to={`/pair/${pairId}/private/${category}`}
            >
              <span className="text-closer-navy font-extrabold">{categoryLabel[category]}</span>
              <span className="text-closer-muted mt-1 block text-sm">
                Open or resume this lane.
              </span>
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

export function PrivateConversationPage() {
  const { pairId = "", category = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => startPrivateConversation(pairId, category),
    onSuccess: (view) => {
      queryClient.setQueryData(privateConversationKey(pairId, category), view);
    },
  });
  const conversation = useQuery({
    queryKey: privateConversationKey(pairId, category),
    queryFn: () => getPrivateConversation(pairId, start.data?.conversationId ?? ""),
    enabled: Boolean(start.data?.conversationId),
    initialData: start.data,
  });

  React.useEffect(() => {
    if (pairId && category && !start.data && !start.isPending && !start.error) start.mutate();
  }, [category, pairId, start]);
  React.useEffect(() => {
    if (!pairId) return undefined;
    return connectPrivateRealtime(pairId, queryClient);
  }, [pairId, queryClient]);

  const view = conversation.data ?? start.data;
  const ask = useMutation({
    mutationFn: ({
      candidateId,
      clientRequestId,
    }: {
      candidateId: string;
      clientRequestId: string;
    }) => askPrivateCandidate(pairId, view?.conversationId ?? "", candidateId, clientRequestId),
    retry: 1,
    onSuccess: (round) => {
      queryClient.setQueryData(privateConversationKey(pairId, category), (current: typeof view) =>
        current
          ? { ...current, state: "CURRENT_ROUND" as const, candidate: undefined, round }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: privateConversationKey(pairId, category) });
    },
  });
  const skip = useMutation({
    mutationFn: ({
      candidateId,
      clientRequestId,
    }: {
      candidateId: string;
      clientRequestId: string;
    }) => skipPrivateCandidate(pairId, view?.conversationId ?? "", candidateId, clientRequestId),
    retry: 1,
    onSuccess: (next) => {
      queryClient.setQueryData(privateConversationKey(pairId, category), next);
      void queryClient.invalidateQueries({ queryKey: privateConversationKey(pairId, category) });
    },
  });
  const like = useMutation({
    mutationFn: ({ candidateId, liked }: { candidateId: string; liked: boolean }) =>
      likePrivateCandidate(pairId, view?.conversationId ?? "", candidateId, liked),
    onSuccess: (result) => {
      queryClient.setQueryData(privateConversationKey(pairId, category), (current: typeof view) =>
        current?.candidate
          ? { ...current, candidate: { ...current.candidate, liked: result.liked } }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: privateConversationKey(pairId, category) });
    },
  });
  const mutationError = ask.error ?? skip.error ?? like.error;
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <button
          className="text-closer-muted self-start text-sm font-bold"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <p className="text-closer-coral mt-10 text-sm font-bold uppercase">
          {categoryLabel[category] ?? "Private"} conversation
        </p>
        {start.isPending && <p className="text-closer-muted mt-8">Opening your conversation…</p>}
        {start.error && <RecoveryPanel error={start.error} onRetry={() => start.mutate()} />}
        {view?.state === "CANDIDATE" && view.candidate && (
          <div className="bg-closer-peach/60 mt-8 rounded-3xl p-6">
            <p className="text-closer-muted text-sm font-bold uppercase">Your next question</p>
            <h1 className="text-closer-navy mt-3 text-3xl leading-tight font-extrabold">
              {view.candidate.question.text}
            </h1>
            <p className="text-closer-muted mt-4 text-sm">
              Your person is waiting for you to choose when you’re ready.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                className="bg-closer-coral text-closer-navy rounded-2xl px-5 py-3 font-extrabold disabled:opacity-50"
                disabled={ask.isPending || skip.isPending || like.isPending}
                onClick={() =>
                  ask.mutate({
                    candidateId: view.candidate!.id,
                    clientRequestId: crypto.randomUUID(),
                  })
                }
              >
                {ask.isPending ? "Asking…" : "Ask this"}
              </button>
              <button
                className="border-closer-line text-closer-navy rounded-2xl border px-5 py-3 font-extrabold disabled:opacity-50"
                disabled={ask.isPending || skip.isPending || like.isPending}
                onClick={() =>
                  skip.mutate({
                    candidateId: view.candidate!.id,
                    clientRequestId: crypto.randomUUID(),
                  })
                }
              >
                {skip.isPending ? "Skipping…" : "Skip"}
              </button>
              <button
                aria-pressed={view.candidate.liked}
                className="text-closer-navy rounded-2xl px-4 py-3 font-extrabold underline decoration-2 underline-offset-4 disabled:opacity-50"
                disabled={ask.isPending || skip.isPending || like.isPending}
                onClick={() =>
                  like.mutate({ candidateId: view.candidate!.id, liked: !view.candidate!.liked })
                }
              >
                {view.candidate.liked ? "♥ Liked" : "♡ Like"}
              </button>
            </div>
          </div>
        )}
        {view?.state === "CURRENT_ROUND" && view.round && (
          <div className="bg-closer-peach/60 mt-8 rounded-3xl p-6">
            <p className="text-closer-muted text-sm font-bold uppercase">
              Round {view.round.roundNumber}
            </p>
            <h1 className="text-closer-navy mt-3 text-3xl leading-tight font-extrabold">
              {view.round.question.text}
            </h1>
            <p className="text-closer-muted mt-4 leading-7">Answers come next.</p>
          </div>
        )}
        {view?.state === "WAITING_FOR_CREATOR" && (
          <div className="bg-closer-lavender/60 mt-8 rounded-3xl p-6">
            <h1 className="text-closer-navy text-3xl font-extrabold">
              A question is being chosen.
            </h1>
            <p className="text-closer-muted mt-3 leading-7">
              Waiting for {view.creatorDisplayName ?? "your person"} to choose a question.
            </p>
          </div>
        )}
        {view?.state === "EXHAUSTED" && (
          <div className="bg-closer-surface border-closer-line mt-8 rounded-3xl border p-6">
            <h1 className="text-closer-navy text-3xl font-extrabold">
              You’ve reached the end of this lane.
            </h1>
            <p className="text-closer-muted mt-3 leading-7">
              There are no more questions available right now.
            </p>
          </div>
        )}
        {conversation.isFetching && !view && <p className="text-closer-muted mt-8">Refreshing…</p>}
        {conversation.error && !start.error && (
          <RecoveryPanel error={conversation.error} onRetry={() => void conversation.refetch()} />
        )}
        {mutationError && (
          <RecoveryPanel error={mutationError} onRetry={() => void conversation.refetch()} />
        )}
      </section>
    </PageShell>
  );
}

function RecoveryPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError && error.status === 404
      ? "This conversation is no longer available."
      : "We couldn’t open this conversation.";
  return (
    <div className="bg-closer-surface border-closer-line mt-8 rounded-3xl border p-6" role="alert">
      <h1 className="text-closer-navy text-2xl font-extrabold">{message}</h1>
      <p className="text-closer-muted mt-2">Check your connection and try again.</p>
      <button
        className="bg-closer-coral text-closer-navy mt-5 rounded-2xl px-5 py-3 font-extrabold"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}
