import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";

import { PageShell } from "@/app/page-shell";
import { EndedPairPage } from "@/features/pair/components";
import { connectPairRealtime, pairQueryKey } from "@/features/pair/realtime";
import { ApiError } from "@/lib/api-client";
import { getPair } from "@/features/consumer/api";
import {
  askPrivateCandidate,
  declinePrivateRound,
  getPrivateConversation,
  getPrivateHistory,
  getPrivateRound,
  likePrivateCandidate,
  privateAnswerSchema,
  privateReplySchema,
  privateReactionValues,
  progressPrivateRound,
  privateCategories,
  removePrivateReaction,
  removePrivateReply,
  revealPrivateRound,
  skipPrivateCandidate,
  startPrivateConversation,
  submitPrivateAnswer,
  setPrivateReaction,
  setPrivateReply,
  type PrivateAnswerValues,
  type PrivateReplyValues,
  type PrivateReactionValue,
  type PrivateConversation,
  type PrivateRound,
  type PrivateHistory,
} from "@/features/private-conversation/api";
import {
  privateConversationKey,
  privateHistoryKey,
  privateRoundKey,
} from "@/features/private-conversation/realtime";

const categoryLabel: Record<string, string> = {
  fun: "Fun",
  deep: "Deep",
  memories: "Memories",
  relationship: "Relationship",
  friendship: "Friendship",
};

const categorySurfaceClass: Record<string, string> = {
  fun: "bg-closer-yellow",
  deep: "bg-closer-blue",
  memories: "bg-closer-mint",
  relationship: "bg-closer-coral-soft",
  friendship: "bg-closer-friendship",
};

export function PrivateCategoryPage() {
  const { pairId = "" } = useParams();
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
  if (pair.data?.state === "terminated") return <EndedPairPage pairId={pairId} />;
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
        {!pair.isSuccess || pair.isFetching ? (
          <p className="text-closer-muted mt-8">Checking your space…</p>
        ) : (
          <>
            <Link
              className="text-closer-navy mt-4 self-start text-sm font-bold underline underline-offset-4"
              to={`/pair/${pairId}/private/history`}
            >
              Look back at shared moments
            </Link>
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
          </>
        )}
      </section>
    </PageShell>
  );
}

export function PrivateConversationPage() {
  const { pairId = "", category = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pair = useQuery({
    queryKey: pairQueryKey(pairId),
    queryFn: () => getPair(pairId),
    enabled: Boolean(pairId),
    retry: false,
    refetchOnMount: "always",
  });
  const activePair = pair.isSuccess && !pair.isFetching && pair.data.state !== "terminated";
  const start = useMutation({
    mutationFn: () => startPrivateConversation(pairId, category),
    onSuccess: (view) => {
      queryClient.setQueryData(privateConversationKey(pairId, category), view);
    },
  });
  const conversation = useQuery({
    queryKey: privateConversationKey(pairId, category),
    queryFn: () => getPrivateConversation(pairId, start.data?.conversationId ?? ""),
    enabled: activePair && Boolean(start.data?.conversationId),
    initialData: start.data,
  });

  React.useEffect(() => {
    if (activePair && pairId && category && !start.data && !start.isPending && !start.error)
      start.mutate();
  }, [activePair, category, pairId, start]);
  React.useEffect(() => {
    if (!pairId || !pair.data || pair.data.state === "terminated") return undefined;
    return connectPairRealtime(pairId, queryClient);
  }, [pair.data?.state, pairId, queryClient]);

  const view = conversation.data ?? start.data;
  const roundId = view?.round?.roundId ?? "";
  const roundQuery = useQuery({
    queryKey: privateRoundKey(pairId, roundId),
    queryFn: () => getPrivateRound(pairId, roundId),
    enabled: activePair && Boolean(roundId),
    initialData: view?.round,
  });
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
  if (pair.data?.state === "terminated") return <EndedPairPage pairId={pairId} />;
  if (!pair.isSuccess || pair.isFetching) {
    return (
      <PageShell>
        <section className="flex flex-1 flex-col py-8">
          {pair.error ? (
            <RecoveryPanel error={pair.error} onRetry={() => void pair.refetch()} />
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
        {view?.state === "CURRENT_ROUND" && roundQuery.data && (
          <PrivateRoundPanel
            availableCategories={view.availableCategories ?? [...privateCategories]}
            category={category}
            pairId={pairId}
            queryClient={queryClient}
            round={roundQuery.data}
          />
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
        <PrivateHistorySection
          pairId={pairId}
          activeRound={view?.round}
          surfaceLoading={start.isPending || conversation.isPending}
        />
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

export function PrivateHistoryPage() {
  const { pairId = "" } = useParams();
  const queryClient = useQueryClient();
  const pair = useQuery({
    queryKey: pairQueryKey(pairId),
    queryFn: () => getPair(pairId),
    enabled: Boolean(pairId),
    retry: false,
    refetchOnMount: "always",
  });
  React.useEffect(() => {
    if (!pairId || !pair.data || pair.data.state === "terminated") return undefined;
    return connectPairRealtime(pairId, queryClient);
  }, [pair.data?.state, pairId, queryClient]);
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted self-start text-sm font-bold" to={`/pair/${pairId}`}>
          ← Back to space
        </Link>
        <p className="text-closer-coral mt-8 text-sm font-bold uppercase">Private</p>
        <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
          Moments you’ve shared
        </h1>
        <PrivateHistorySection pairId={pairId} />
      </section>
    </PageShell>
  );
}

export function PrivateHistorySection({
  pairId,
  activeRound,
  surfaceLoading = false,
}: {
  pairId: string;
  activeRound?: PrivateRound;
  surfaceLoading?: boolean;
}) {
  const history = useInfiniteQuery({
    queryKey: privateHistoryKey(pairId),
    queryFn: ({ pageParam }) => getPrivateHistory(pairId, pageParam),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(pairId),
  });
  const rounds = visiblePrivateHistoryRounds(
    history.data?.pages.flatMap((page) => page.rounds) ?? [],
    activeRound,
  );

  return (
    <section aria-label="Private history" className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-closer-muted text-xs font-bold tracking-[.12em] uppercase">
            Looking back
          </p>
          <h2 className="text-closer-navy mt-1 text-2xl font-extrabold">Your shared story</h2>
        </div>
      </div>
      {history.isPending && !surfaceLoading && (
        <p className="text-closer-muted bg-closer-surface rounded-3xl px-5 py-6">
          Loading your shared moments…
        </p>
      )}
      {history.error && (
        <RecoveryPanel error={history.error} onRetry={() => void history.refetch()} />
      )}
      {history.data && rounds.length === 0 && !history.hasNextPage && (
        <p className="text-closer-muted border-closer-line bg-closer-surface rounded-3xl border px-5 py-6 text-sm leading-6">
          Your revealed moments will gather here as you share them.
        </p>
      )}
      <ol className="grid gap-4">
        {rounds.map((round, index) => (
          <PrivateHistoryRoundCard
            key={`${round.askedAt}:${round.roundNumber}:${index}`}
            round={round}
          />
        ))}
      </ol>
      {history.hasNextPage && (
        <button
          className="border-closer-line text-closer-navy mt-4 w-full rounded-2xl border px-4 py-3 text-sm font-extrabold disabled:opacity-50"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Finding earlier moments…" : "Load earlier moments"}
        </button>
      )}
    </section>
  );
}

export function visiblePrivateHistoryRounds(
  rounds: PrivateHistory["rounds"],
  activeRound?: Pick<PrivateRound, "askedAt" | "roundNumber">,
) {
  return rounds
    .filter(
      (round) =>
        !activeRound ||
        round.askedAt !== activeRound.askedAt ||
        round.roundNumber !== activeRound.roundNumber,
    )
    .sort(
      (a, b) =>
        b.askedAt.localeCompare(a.askedAt) ||
        b.roundNumber - a.roundNumber ||
        a.question.text.localeCompare(b.question.text),
    );
}

export function PrivateHistoryRoundCard({ round }: { round: PrivateHistory["rounds"][number] }) {
  return (
    <li className="bg-closer-surface border-closer-line rounded-3xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`${categorySurfaceClass[round.question.category] ?? "bg-closer-peach/60"} text-closer-navy rounded-full px-3 py-1 text-xs font-extrabold`}
        >
          {categoryLabel[round.question.category] ?? round.question.category}
        </span>
        <time className="text-closer-muted text-xs font-semibold" dateTime={round.askedAt}>
          {new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(new Date(round.askedAt))}
        </time>
      </div>
      <h3 className="text-closer-navy mt-4 text-lg leading-snug font-extrabold">
        {round.question.text}
      </h3>
      <div className="mt-4 grid gap-2">
        {round.answers.map((answer, index) => (
          <div
            className="bg-closer-cream/70 rounded-2xl px-4 py-3"
            key={`${answer.displayName}-${index}`}
          >
            <p className="text-closer-muted text-xs font-bold">{answer.displayName}</p>
            <p className="text-closer-navy mt-1 text-sm leading-6 whitespace-pre-wrap">
              {answer.body}
            </p>
          </div>
        ))}
      </div>
      {(round.reactions.length > 0 || round.replies.length > 0) && (
        <div className="border-closer-line mt-4 space-y-2 border-t pt-3">
          {round.reactions.map((reaction, index) => (
            <p
              className="text-closer-muted text-xs font-semibold"
              key={`${reaction.displayName}-${index}`}
            >
              {reaction.displayName} reacted · {reaction.value}
            </p>
          ))}
          {round.replies.map((reply, index) => (
            <p className="text-closer-navy text-sm leading-6" key={`${reply.displayName}-${index}`}>
              <span className="font-bold">{reply.displayName}: </span>
              {reply.body}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

export function PrivateRoundPanel({
  availableCategories,
  category,
  pairId,
  queryClient,
  round,
}: {
  availableCategories: string[];
  category: string;
  pairId: string;
  queryClient: QueryClient;
  round: PrivateRound;
}) {
  const navigate = useNavigate();
  const answerForm = useForm<PrivateAnswerValues>({
    defaultValues: { body: "" },
    mode: "onChange",
    resolver: zodResolver(privateAnswerSchema),
  });
  const replyForm = useForm<PrivateReplyValues>({
    defaultValues: { body: "" },
    mode: "onChange",
    resolver: zodResolver(privateReplySchema),
  });
  const existingReply = round.replies?.find((item) => item.isOwner)?.body ?? "";
  React.useEffect(() => {
    replyForm.reset({ body: existingReply });
  }, [existingReply, replyForm.reset, round.roundId]);
  const updateRound = React.useCallback(
    (next: PrivateRound) => {
      queryClient.setQueryData(privateRoundKey(pairId, round.roundId), next);
      queryClient.setQueryData(
        privateConversationKey(pairId, category),
        (current: PrivateConversation | undefined) =>
          current ? { ...current, round: next } : current,
      );
      void queryClient.invalidateQueries({ queryKey: privateConversationKey(pairId, category) });
      void queryClient.invalidateQueries({ queryKey: privateHistoryKey(pairId) });
    },
    [category, pairId, queryClient, round.roundId],
  );
  const answer = useMutation({
    mutationFn: (values: PrivateAnswerValues) =>
      submitPrivateAnswer(pairId, round.roundId, values.body),
    onSuccess: (next) => {
      answerForm.reset();
      updateRound(next);
    },
  });
  const decline = useMutation({
    mutationFn: () => declinePrivateRound(pairId, round.roundId),
    onSuccess: updateRound,
  });
  const reveal = useMutation({
    mutationFn: () => revealPrivateRound(pairId, round.roundId),
    onSuccess: updateRound,
  });
  const reaction = useMutation({
    mutationFn: ({ value }: { value: PrivateReactionValue | null }) =>
      value
        ? setPrivateReaction(pairId, round.roundId, value)
        : removePrivateReaction(pairId, round.roundId),
    onSuccess: updateRound,
  });
  const reply = useMutation({
    mutationFn: (values: PrivateReplyValues) => setPrivateReply(pairId, round.roundId, values.body),
    onSuccess: (next) => {
      updateRound(next);
      replyForm.reset({ body: next.replies?.find((item) => item.isOwner)?.body ?? "" });
    },
  });
  const clearReply = useMutation({
    mutationFn: () => removePrivateReply(pairId, round.roundId),
    onSuccess: (next) => {
      updateRound(next);
      replyForm.reset({ body: "" });
    },
  });
  const [choosingLane, setChoosingLane] = React.useState(false);
  const progress = useMutation({
    mutationFn: ({
      action,
      category,
      clientRequestId,
    }: {
      action: "ask_another" | "something_else";
      category: string;
      clientRequestId: string;
    }) => progressPrivateRound(pairId, round.roundId, action, category, clientRequestId),
    retry: 1,
    onSuccess: (next) => {
      queryClient.setQueryData(privateConversationKey(pairId, next.category), next);
      void queryClient.invalidateQueries({
        queryKey: privateConversationKey(pairId, next.category),
      });
      navigate(`/pair/${pairId}/private/${next.category}`);
    },
  });

  const hasOwnAnswer = round.yourAnswer !== null && round.yourAnswer !== undefined;
  const hasOtherAnswer = round.hasOtherAnswer === true;
  const isDeclined = round.state === "DECLINED" || round.state === "RETIRED";
  const isRevealed = round.state === "REVEAL_VIEWED" || Boolean(round.revealViewedAt);
  const isRevealReady =
    round.state === "REVEAL_READY" ||
    (hasOwnAnswer && hasOtherAnswer && !isRevealed && !isDeclined);
  const error =
    answer.error ??
    decline.error ??
    reveal.error ??
    reaction.error ??
    reply.error ??
    clearReply.error ??
    progress.error;
  const busy =
    answer.isPending ||
    decline.isPending ||
    reveal.isPending ||
    reaction.isPending ||
    reply.isPending ||
    clearReply.isPending ||
    progress.isPending;

  return (
    <div className="bg-closer-peach/60 mt-8 rounded-3xl p-6">
      <p className="text-closer-muted text-sm font-bold uppercase">Round {round.roundNumber}</p>
      <h1 className="text-closer-navy mt-3 text-3xl leading-tight font-extrabold">
        {round.question.text}
      </h1>

      {isDeclined ? (
        <div className="mt-5 rounded-2xl bg-white/60 p-4">
          <p className="text-closer-navy font-extrabold">This question was let go.</p>
          <p className="text-closer-muted mt-1 text-sm leading-6">
            It stays private, and no answer can be added to this round.
          </p>
          {round.canContinue && (
            <div className="mt-5 grid gap-2">
              <button
                className="bg-closer-coral text-closer-navy rounded-2xl px-5 py-3 font-extrabold disabled:opacity-50"
                disabled={busy}
                onClick={() =>
                  progress.mutate({
                    action: "ask_another",
                    category: round.question.category,
                    clientRequestId: crypto.randomUUID(),
                  })
                }
                type="button"
              >
                Ask another
              </button>
              <button
                className="border-closer-line text-closer-navy rounded-2xl border px-5 py-3 font-extrabold"
                disabled={busy}
                onClick={() => setChoosingLane((value) => !value)}
                type="button"
              >
                Something else
              </button>
              {choosingLane &&
                availableCategories
                  .filter((category) => category !== round.question.category)
                  .map((category) => (
                    <button
                      className="text-closer-navy rounded-xl bg-white px-4 py-3 text-left font-bold"
                      disabled={busy}
                      key={category}
                      onClick={() =>
                        progress.mutate({
                          action: "something_else",
                          category,
                          clientRequestId: crypto.randomUUID(),
                        })
                      }
                      type="button"
                    >
                      {categoryLabel[category] ?? category}
                    </button>
                  ))}
              <button
                className="text-closer-muted rounded-2xl px-5 py-3 font-bold"
                onClick={() => navigate(`/pair/${pairId}`)}
                type="button"
              >
                Leave it here
              </button>
            </div>
          )}
        </div>
      ) : isRevealed ? (
        <div>
          <RevealedAnswers round={round} />
          <div className="mt-6 rounded-2xl bg-white/60 p-4">
            <p className="text-closer-navy font-extrabold">React to your person’s answer</p>
            <div className="mt-3 flex gap-2" aria-label="Choose a reaction">
              {privateReactionValues.map((value) => {
                const selected = round.reactions?.find((item) => item.isOwner)?.value === value;
                const emoji = { heart: "❤️", laugh: "😂", tender: "🥺", surprised: "😮" }[value];
                return (
                  <button
                    aria-pressed={selected}
                    className="rounded-xl bg-white px-3 py-2 text-xl"
                    key={value}
                    onClick={() => reaction.mutate({ value: selected ? null : value })}
                    type="button"
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
            <form
              className="mt-5"
              onSubmit={replyForm.handleSubmit((values) => reply.mutate(values))}
            >
              <label className="text-closer-navy text-sm font-extrabold" htmlFor="private-reply">
                A short reply
              </label>
              <textarea
                {...replyForm.register("body")}
                className="border-closer-line mt-2 min-h-20 w-full rounded-2xl border bg-white/75 p-3 text-sm"
                id="private-reply"
                maxLength={500}
                placeholder="Add a thought…"
              />
              {replyForm.formState.errors.body?.message && (
                <p className="text-closer-coral mt-1 text-sm" role="alert">
                  {replyForm.formState.errors.body.message}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  className="bg-closer-coral text-closer-navy rounded-xl px-4 py-2 text-sm font-extrabold disabled:opacity-50"
                  disabled={!replyForm.formState.isValid || busy}
                  type="submit"
                >
                  {reply.isPending ? "Saving…" : "Save reply"}
                </button>
                {round.replies?.some((item) => item.isOwner) && (
                  <button
                    className="text-closer-muted rounded-xl px-3 py-2 text-sm font-bold"
                    disabled={busy}
                    onClick={() => clearReply.mutate()}
                    type="button"
                  >
                    Remove reply
                  </button>
                )}
              </div>
            </form>
            {round.reactions
              ?.filter((item) => !item.isOwner)
              .map((item) => (
                <p className="text-closer-muted mt-3 text-sm" key={item.participantId}>
                  {item.displayName} reacted{" "}
                  {
                    ({ heart: "❤️", laugh: "😂", tender: "🥺", surprised: "😮" } as const)[
                      item.value
                    ]
                  }{" "}
                  to your answer.
                </p>
              ))}
            {round.replies
              ?.filter((item) => !item.isOwner)
              .map((item) => (
                <p className="text-closer-muted mt-2 text-sm" key={item.participantId}>
                  {item.displayName}: “{item.body}”
                </p>
              ))}
          </div>
          {round.canContinue && (
            <div className="mt-5 grid gap-2">
              <button
                className="bg-closer-coral text-closer-navy rounded-2xl px-5 py-3 font-extrabold disabled:opacity-50"
                disabled={busy}
                onClick={() =>
                  progress.mutate({
                    action: "ask_another",
                    category: round.question.category,
                    clientRequestId: crypto.randomUUID(),
                  })
                }
                type="button"
              >
                {progress.isPending && progress.variables?.action === "ask_another"
                  ? "Choosing…"
                  : "Ask another"}
              </button>
              <button
                className="border-closer-line text-closer-navy rounded-2xl border px-5 py-3 font-extrabold"
                disabled={busy}
                onClick={() => setChoosingLane((value) => !value)}
                type="button"
              >
                Something else
              </button>
              {choosingLane && (
                <div className="grid gap-2 rounded-2xl bg-white/60 p-3">
                  <p className="text-closer-muted text-sm">Choose another lane.</p>
                  {availableCategories
                    .filter((category) => category !== round.question.category)
                    .map((category) => (
                      <button
                        className="text-closer-navy rounded-xl bg-white px-4 py-3 text-left font-bold"
                        disabled={busy}
                        key={category}
                        onClick={() =>
                          progress.mutate({
                            action: "something_else",
                            category,
                            clientRequestId: crypto.randomUUID(),
                          })
                        }
                        type="button"
                      >
                        {categoryLabel[category] ?? category}
                      </button>
                    ))}
                </div>
              )}
              <button
                className="text-closer-muted rounded-2xl px-5 py-3 font-bold"
                onClick={() => navigate(`/pair/${pairId}`)}
                type="button"
              >
                Leave it here
              </button>
            </div>
          )}
        </div>
      ) : isRevealReady ? (
        <div className="mt-5">
          <p className="text-closer-muted leading-7">
            Both answers are in. Reveal opens them for you; your person can reveal theirs
            separately.
          </p>
          <button
            className="bg-closer-coral text-closer-navy mt-5 rounded-2xl px-5 py-3 font-extrabold disabled:opacity-50"
            disabled={busy}
            onClick={() => reveal.mutate()}
            type="button"
          >
            {reveal.isPending ? "Opening…" : "Reveal answers"}
          </button>
        </div>
      ) : hasOwnAnswer ? (
        <div className="mt-5 rounded-2xl bg-white/60 p-4">
          <p className="text-closer-navy font-extrabold">Answer saved</p>
          <p className="text-closer-muted mt-1 text-sm leading-6">
            Your person’s answer stays hidden until you choose to reveal your own view.
          </p>
        </div>
      ) : (
        <form
          className="mt-5"
          onSubmit={answerForm.handleSubmit((values) => answer.mutate(values))}
        >
          <label className="text-closer-navy text-sm font-extrabold" htmlFor="private-answer">
            Your answer
          </label>
          <textarea
            {...answerForm.register("body")}
            aria-describedby="private-answer-help private-answer-error"
            aria-invalid={Boolean(answerForm.formState.errors.body)}
            className="border-closer-line mt-2 min-h-32 w-full rounded-2xl border bg-white/75 p-4 text-sm outline-none focus:ring-2 focus:ring-[#29305f]/20"
            id="private-answer"
            maxLength={2000}
            placeholder="Write your answer…"
          />
          <p className="text-closer-muted mt-2 text-xs" id="private-answer-help">
            Your person cannot see this yet.
          </p>
          {answerForm.formState.errors.body?.message && (
            <p className="text-closer-coral mt-2 text-sm" id="private-answer-error" role="alert">
              {answerForm.formState.errors.body.message}
            </p>
          )}
          <button
            className="bg-closer-coral text-closer-navy mt-4 rounded-2xl px-5 py-3 font-extrabold disabled:opacity-50"
            disabled={busy || !answerForm.formState.isValid}
            type="submit"
          >
            {answer.isPending ? "Saving…" : "Save my answer"}
          </button>
          <button
            className="border-closer-line text-closer-navy ml-3 rounded-2xl border px-5 py-3 font-extrabold disabled:opacity-50"
            disabled={busy}
            onClick={() => decline.mutate()}
            type="button"
          >
            {decline.isPending ? "Letting go…" : "Let this one go"}
          </button>
        </form>
      )}

      {isRevealed && round.otherRevealViewed === false && (
        <p className="text-closer-muted mt-5 text-sm leading-6">
          Your reveal is independent. Your person has not opened their view yet.
        </p>
      )}
      {error && (
        <p className="text-closer-coral mt-4 text-sm" role="alert">
          {error instanceof Error ? error.message : "That action could not be completed."}
        </p>
      )}
    </div>
  );
}

function RevealedAnswers({ round }: { round: PrivateRound }) {
  const answers = round.answers ?? [];
  return (
    <div className="mt-5 space-y-3">
      <p className="text-closer-navy font-extrabold">Your answers</p>
      {answers.length > 0 ? (
        answers.map((answer, index) => (
          <article className="rounded-2xl bg-white/70 p-4" key={`${answer.participantId}-${index}`}>
            <p className="text-closer-muted text-xs font-bold uppercase">
              {answer.isOwner ? "Your answer" : "Your person’s answer"}
            </p>
            <p className="text-closer-navy mt-2 leading-7">{answer.body}</p>
          </article>
        ))
      ) : (
        <p className="text-closer-muted text-sm leading-6">
          Your reveal is recorded. Refreshing the shared answers…
        </p>
      )}
    </div>
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
