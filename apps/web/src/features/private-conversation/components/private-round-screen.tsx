"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Heart, LockKeyhole, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button, buttonVariants } from "@Closer/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@Closer/ui/components/field";
import { Textarea } from "@Closer/ui/components/textarea";
import { cn } from "@Closer/ui/lib/utils";

import { AsyncButton } from "@/components/closer/async-button";
import { CategoryBadge, type CloserCategory } from "@/components/closer/category";
import { ActionError } from "@/components/closer/feedback";
import { CloserBackLink } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import {
  CloserCompanions,
  CloserPageShell,
  CloserRoundHeader,
} from "@/components/closer/page-shell";
import { closerKeys } from "@/lib/query/closer-query-keys";
import {
  privateAnswerSchema,
  privateReplySchema,
  type PrivateAnswerValues,
  type PrivateReplyValues,
} from "@/contracts/private-round/private-round.schema";

type ReactionValue = "heart" | "laugh" | "tender" | "surprised";
type RoundView = {
  id: string;
  pairId: string;
  conversation: { id: string; category: string; questionNumber: number; isCreator: boolean };
  question: {
    id: string;
    questionRevisionId: string;
    text: string;
    category: string;
    intensity: string;
  };
  otherParticipant: { id: string; displayName: string };
  yourAnswer: string | null;
  state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED" | "DECLINED";
  revealViewedAt: string | null;
  otherRevealViewed: boolean;
  answers?: Array<{ participantId: string; displayName: string; body: string }>;
  reactions?: Array<{ participantId: string; displayName: string; value: ReactionValue }>;
  replies?: Array<{ participantId: string; displayName: string; body: string; isOwner: boolean }>;
};

const reactions: Array<{ value: ReactionValue; label: string; glyph: string }> = [
  { value: "heart", label: "Love", glyph: "❤️" },
  { value: "laugh", label: "Laugh", glyph: "😂" },
  { value: "tender", label: "Tender", glyph: "🥺" },
  { value: "surprised", label: "Surprised", glyph: "😮" },
];

function parseRound(value: unknown): RoundView | null {
  if (!value || typeof value !== "object" || !("state" in value) || typeof value.state !== "string")
    return null;
  return value as RoundView;
}

export default function PrivateRoundScreen({ initialRound }: { initialRound: RoundView }) {
  const [round, setRound] = useState(initialRound);
  const [isPassing, setIsPassing] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isRemovingReply, setIsRemovingReply] = useState(false);
  const [optimisticReaction, setOptimisticReaction] = useState<ReactionValue | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const answerForm = useForm<PrivateAnswerValues>({
    defaultValues: { body: initialRound.yourAnswer ?? "" },
    mode: "onChange",
    resolver: zodResolver(privateAnswerSchema),
  });
  const replyForm = useForm<PrivateReplyValues>({
    defaultValues: { body: initialRound.replies?.find((item) => item.isOwner)?.body ?? "" },
    mode: "onChange",
    resolver: zodResolver(privateReplySchema),
  });
  const baseUrl = `/api/pairs/${encodeURIComponent(round.pairId)}/private-rounds/${encodeURIComponent(round.id)}`;
  const roundQuery = useQuery({
    queryKey: closerKeys.privateRound(initialRound.pairId, initialRound.id),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/pairs/${encodeURIComponent(initialRound.pairId)}/private-rounds/${encodeURIComponent(initialRound.id)}`,
        { cache: "no-store", signal },
      );
      const next = response.ok ? parseRound(await response.json()) : null;
      if (!next) throw new Error("Unable to refresh Private Round.");
      return next;
    },
    initialData: initialRound,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (roundQuery.data) setRound(roundQuery.data);
  }, [roundQuery.data]);

  async function reconcileRound(fallback: RoundView) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      const next = response.ok ? parseRound(await response.json()) : null;
      setRound(next ?? fallback);
    } catch {
      setRound(fallback);
    }
  }

  async function submitAnswer(values: PrivateAnswerValues) {
    setError(null);
    answerForm.clearErrors("root.server");
    const previousRound = round;
    // Waiting is safe to show before the server responds: it contains only the
    // answer this participant just entered and no state about the other answer.
    setRound({ ...round, state: "WAITING", yourAnswer: values.body });
    try {
      const response = await fetch(`${baseUrl}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: values.body }),
      });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      await reconcileRound(previousRound);
      answerForm.setError("root.server", {
        message: "Your answer needs 1–2,000 characters. Nothing was saved—please try again.",
      });
    }
  }

  async function reveal() {
    setError(null);
    setIsRevealing(true);
    try {
      const response = await fetch(`${baseUrl}/reveal`, { method: "POST" });
      const next = parseRound(await response.json());
      if (!response.ok || !next || !next.answers) throw new Error();
      setRound(next);
    } catch {
      setError("Your answers are still getting ready. Please try again.");
    } finally {
      setIsRevealing(false);
    }
  }

  async function passQuestion() {
    setError(null);
    const previousRound = round;
    setIsPassing(true);
    setRound({ ...round, state: "DECLINED" });
    try {
      const response = await fetch(`${baseUrl}/decline`, { method: "POST" });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      await reconcileRound(previousRound);
      setError("We couldn’t pass this question. Please try again.");
    } finally {
      setIsPassing(false);
    }
  }

  async function updateReaction(value: ReactionValue) {
    setError(null);
    const selected = round.reactions?.find(
      (item) => item.participantId !== round.otherParticipant.id,
    )?.value;
    const nextReaction = selected === value ? null : value;
    setOptimisticReaction(nextReaction);
    try {
      const response = await fetch(
        `${baseUrl}/reaction`,
        selected === value
          ? { method: "DELETE" }
          : {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ value }),
            },
      );
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      setOptimisticReaction(undefined);
      setError("We couldn’t save that reaction. Please try again.");
    } finally {
      setOptimisticReaction(undefined);
    }
  }

  async function saveReply(values: PrivateReplyValues) {
    setError(null);
    replyForm.clearErrors("root.server");
    try {
      const response = await fetch(`${baseUrl}/reply`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: values.body }),
      });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
      replyForm.reset({ body: next.replies?.find((item) => item.isOwner)?.body ?? values.body });
    } catch {
      replyForm.setError("root.server", {
        message: "Replies need 1–500 characters. Please try again.",
      });
    }
  }

  async function removeReply() {
    setError(null);
    setIsRemovingReply(true);
    try {
      const response = await fetch(`${baseUrl}/reply`, { method: "DELETE" });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
      replyForm.reset({ body: "" });
    } catch {
      setError("We couldn’t remove that reply. Please try again.");
    } finally {
      setIsRemovingReply(false);
    }
  }

  const header = (
    <CloserRoundHeader>
      <CloserBackLink href={`/pair/${round.pairId}`} label="Back to pair" />
      <ModeBadge mode="private" />
      <span aria-hidden="true" className="w-[38px]" />
    </CloserRoundHeader>
  );

  if (round.state === "YOUR_TURN") {
    const nameError = answerForm.formState.errors.body;
    return (
      <CloserPageShell className="pt-5">
        {header}
        <section className="flex min-h-[calc(100svh-100px)] flex-col items-center pt-6">
          <CategoryBadge category={round.question.category as CloserCategory} />
          <p className="text-closer-muted mt-3 text-center text-xs font-bold tracking-[.01em] capitalize">
            {round.question.category} · Question {round.conversation.questionNumber}
          </p>
          <h1 className="mx-auto my-7 max-w-[15ch] text-center text-[clamp(2rem,9vw,2.8rem)] leading-tight font-extrabold tracking-[-.048em] text-balance">
            “{round.question.text}”
          </h1>
          <form className="flex w-full flex-col" onSubmit={answerForm.handleSubmit(submitAnswer)}>
            <FieldGroup>
              <Field data-invalid={!!nameError}>
                <FieldLabel className="sr-only" htmlFor="private-answer">
                  Your answer
                </FieldLabel>
                <Textarea
                  {...answerForm.register("body")}
                  aria-describedby={nameError ? "private-answer-error" : "private-answer-help"}
                  aria-invalid={!!nameError}
                  id="private-answer"
                  maxLength={2000}
                  placeholder="Write your answer…"
                />
                <FieldError
                  errors={nameError ? [nameError] : undefined}
                  id="private-answer-error"
                />
              </Field>
            </FieldGroup>
            {answerForm.formState.errors.root?.server?.message ? (
              <ActionError>{answerForm.formState.errors.root.server.message}</ActionError>
            ) : null}
            <AsyncButton
              className="mt-[18px] w-full"
              disabled={!answerForm.formState.isValid}
              pending={answerForm.formState.isSubmitting}
              pendingText="Saving…"
              size="lg"
              type="submit"
            >
              Save my answer
            </AsyncButton>
            <AsyncButton
              className="mt-3 w-full"
              onClick={() => void passQuestion()}
              pending={isPassing}
              pendingText="Passing…"
              size="lg"
              type="button"
              variant="ghost"
            >
              Pass this question
            </AsyncButton>
          </form>
          {error ? <ActionError>{error}</ActionError> : null}
          <p
            className="text-closer-muted mt-4 flex items-center justify-center gap-2 text-center text-[.85rem]"
            id="private-answer-help"
          >
            <LockKeyhole aria-hidden="true" className="size-4" />
            {round.otherParticipant.displayName} won’t see your answer yet.
          </p>
        </section>
      </CloserPageShell>
    );
  }

  if (round.state === "WAITING") {
    return (
      <CloserPageShell className="pt-5">
        {header}
        <section className="flex min-h-[calc(100svh-110px)] flex-col items-center justify-center pb-9 text-center">
          <CloserCompanions className="mb-7" />
          <h1 className="text-[2.25rem] leading-tight font-extrabold tracking-[-.048em]">
            Answer saved
          </h1>
          <h2 className="mt-1 text-[1.35rem] font-extrabold">
            Waiting for {round.otherParticipant.displayName}
          </h2>
          <p className="text-closer-muted mx-auto my-6 max-w-[27ch] leading-relaxed">
            You’ll both see your answers when {round.otherParticipant.displayName} responds.
          </p>
          <div className="grid justify-items-center gap-3">
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={`/pair/${round.pairId}` as never}
              prefetch
            >
              Back to Closer
            </Link>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={`/pair/${round.pairId}/private` as never}
              prefetch
            >
              Choose another topic
            </Link>
          </div>
        </section>
      </CloserPageShell>
    );
  }

  if (round.state === "REVEAL_READY") {
    return (
      <CloserPageShell className="pt-5">
        {header}
        <section className="flex min-h-[calc(100svh-110px)] flex-col items-center justify-center pb-9 text-center">
          <Heart
            aria-hidden="true"
            className="text-closer-coral mb-5 size-14"
            fill="currentColor"
          />
          <p className="text-closer-muted text-center text-xs font-bold tracking-[.01em] capitalize">
            {round.question.category} · Question {round.conversation.questionNumber}
          </p>
          <h1 className="mt-3 max-w-[12ch] text-[2.4rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
            Your answers are ready
          </h1>
          <p className="text-closer-muted mx-auto my-6 max-w-[27ch] leading-relaxed">
            Two perspectives, waiting to be shared.
          </p>
          <AsyncButton
            className="w-full max-w-[320px]"
            onClick={() => void reveal()}
            pending={isRevealing}
            pendingText="Opening…"
            size="lg"
            type="button"
          >
            Reveal
          </AsyncButton>
          {error ? <ActionError>{error}</ActionError> : null}
        </section>
      </CloserPageShell>
    );
  }

  if (round.state === "DECLINED") {
    return (
      <CloserPageShell className="pt-5">
        {header}
        <section className="flex min-h-[calc(100svh-110px)] flex-col items-center justify-center pb-9 text-center">
          <CloserCompanions className="mb-7" />
          <h1 className="text-[2.25rem] leading-tight font-extrabold tracking-[-.048em]">
            Question passed
          </h1>
          <p className="text-closer-muted mx-auto my-6 max-w-[27ch] leading-relaxed">
            This question is complete without a reveal.
          </p>
          {round.conversation.isCreator ? (
            <Link
              className={buttonVariants({ size: "lg" })}
              href={`/pair/${round.pairId}/private` as never}
              prefetch
            >
              Choose next question
            </Link>
          ) : (
            <p className="text-closer-muted text-sm leading-relaxed">
              Waiting for {round.otherParticipant.displayName} to choose a question.
            </p>
          )}
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "mt-3")}
            href={`/pair/${round.pairId}` as never}
            prefetch
          >
            Back to Closer
          </Link>
        </section>
      </CloserPageShell>
    );
  }

  const selectedReaction =
    optimisticReaction === undefined
      ? round.reactions?.find((item) => item.participantId !== round.otherParticipant.id)?.value
      : optimisticReaction;
  const ownReply = round.replies?.find((item) => item.isOwner);
  return (
    <CloserPageShell className="pt-5">
      {header}
      <section className="pt-7">
        <p className="text-closer-muted text-center text-xs font-bold tracking-[.01em] capitalize">
          {round.question.category} · Question {round.conversation.questionNumber}
        </p>
        <h1 className="mt-3 text-center text-[2.25rem] leading-tight font-extrabold tracking-[-.048em]">
          Your answers
        </h1>
        <p className="text-closer-muted mt-2 text-center">Two perspectives. A closer us.</p>
        {round.conversation.isCreator && !round.otherRevealViewed ? (
          <p className="text-closer-muted mt-3 text-center text-sm leading-relaxed">
            Waiting for {round.otherParticipant.displayName} to view the reveal.
          </p>
        ) : null}
        {!round.conversation.isCreator ? (
          <p className="text-closer-muted mt-3 text-center text-sm leading-relaxed">
            Waiting for {round.otherParticipant.displayName} to choose a question.
          </p>
        ) : null}
        <div className="mt-7 grid gap-3">
          {round.answers?.map((item, index) => {
            const partnerReaction = round.reactions?.find(
              (reaction) => reaction.participantId !== item.participantId,
            );
            const reactionGlyph = reactions.find(
              (reaction) => reaction.value === partnerReaction?.value,
            )?.glyph;
            return (
              <article
                className={cn(
                  "text-closer-navy relative grid animate-[closer-reveal-card_440ms_cubic-bezier(.2,.85,.3,1)_both] grid-cols-[48px_1fr] gap-3 rounded-[1.45rem] px-[17px] py-[17px] pr-[62px]",
                  index === 0 ? "bg-closer-coral-soft" : "bg-closer-lavender-soft",
                  index === 1 && "[animation-delay:85ms]",
                )}
                key={item.participantId}
              >
                <span
                  aria-hidden="true"
                  className="grid size-[47px] place-items-center rounded-[1.05rem] bg-white/60 text-[1.15rem] font-extrabold"
                >
                  {item.displayName.slice(0, 1)}
                </span>
                <div>
                  <h2 className="font-extrabold">{item.displayName}</h2>
                  <p className="mt-1 text-[.94rem] leading-relaxed">{item.body}</p>
                </div>
                {reactionGlyph ? (
                  <span
                    aria-label={`${partnerReaction?.displayName} reacted`}
                    className="absolute top-[15px] right-[15px] grid size-[33px] place-items-center rounded-[.8rem] bg-white/70 text-[1.05rem] shadow-[0_5px_12px_rgba(27,33,78,0.11)]"
                  >
                    {reactionGlyph}
                  </span>
                ) : null}
              </article>
            );
          })}
        </div>
        <div
          aria-label={`Choose your reaction to ${round.otherParticipant.displayName}'s answer`}
          className="my-6 grid grid-cols-4 gap-2.5"
        >
          {reactions.map((reaction) => (
            <button
              aria-label={reaction.label}
              aria-pressed={selectedReaction === reaction.value}
              className={cn(
                "shadow-closer-soft focus-visible:ring-closer-navy grid min-h-[55px] place-items-center rounded-[1.2rem] border-2 border-transparent bg-white text-[1.45rem] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70",
                selectedReaction === reaction.value &&
                  "border-closer-lavender bg-closer-lavender-soft",
              )}
              disabled={optimisticReaction !== undefined}
              key={reaction.value}
              onClick={() => void updateReaction(reaction.value)}
              type="button"
            >
              {reaction.glyph}
            </button>
          ))}
        </div>
        <form
          className="rounded-[1.375rem] bg-white/75 p-[17px]"
          onSubmit={replyForm.handleSubmit(saveReply)}
        >
          <FieldGroup>
            <Field data-invalid={!!replyForm.formState.errors.body}>
              <FieldLabel htmlFor="private-reply">
                <MessageCircle aria-hidden="true" className="size-[18px]" />
                Reply to {round.otherParticipant.displayName}
              </FieldLabel>
              <Textarea
                {...replyForm.register("body")}
                aria-describedby={
                  replyForm.formState.errors.body ? "private-reply-error" : undefined
                }
                aria-invalid={!!replyForm.formState.errors.body}
                className="mt-2.5 min-h-[94px] text-sm shadow-none"
                id="private-reply"
                maxLength={500}
                placeholder={`Share a short thought with ${round.otherParticipant.displayName}…`}
              />
              <FieldError
                errors={
                  replyForm.formState.errors.body ? [replyForm.formState.errors.body] : undefined
                }
                id="private-reply-error"
              />
            </Field>
          </FieldGroup>
          {replyForm.formState.errors.root?.server?.message ? (
            <ActionError>{replyForm.formState.errors.root.server.message}</ActionError>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-2.5">
            <AsyncButton
              disabled={!replyForm.formState.isValid}
              pending={replyForm.formState.isSubmitting}
              pendingText={
                <>
                  <Send aria-hidden="true" data-icon="inline-start" />
                  Saving…
                </>
              }
              size="sm"
              type="submit"
            >
              <Send aria-hidden="true" data-icon="inline-start" />
              {ownReply ? "Save reply" : "Add reply"}
            </AsyncButton>
            {ownReply ? (
              <AsyncButton
                onClick={() => void removeReply()}
                pending={isRemovingReply}
                pendingText="Removing…"
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </AsyncButton>
            ) : null}
          </div>
        </form>
        {round.replies
          ?.filter((item) => !item.isOwner)
          .map((item) => (
            <p
              className="text-closer-muted px-1.5 py-3 text-[.9rem] leading-relaxed"
              key={item.participantId}
            >
              <strong className="text-closer-navy">{item.displayName}</strong> {item.body}
            </p>
          ))}
        {round.conversation.isCreator && round.otherRevealViewed ? (
          <Link
            className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-2.5 w-full")}
            href={`/pair/${round.pairId}/private` as never}
            prefetch
          >
            Choose next question
          </Link>
        ) : null}
        <Link
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            "mx-auto mt-2 flex w-fit",
          )}
          href={`/pair/${round.pairId}` as never}
          prefetch
        >
          Back to Closer
        </Link>
        {error ? <ActionError>{error}</ActionError> : null}
      </section>
    </CloserPageShell>
  );
}
