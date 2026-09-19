"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@Closer/ui/components/button";
import { Textarea } from "@Closer/ui/components/textarea";
import { cn } from "@Closer/ui/lib/utils";

import { AsyncButton } from "@/components/closer/async-button";
import { ActionError } from "@/components/closer/feedback";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ModeBadge } from "@/components/closer/mode-badge";
import { closerKeys } from "@/lib/query/closer-query-keys";

type ConversationProjection = {
  id: string;
  pairId: string;
  category: string;
  state: "CANDIDATE" | "CURRENT_ROUND" | "READY_FOR_NEXT" | "EXHAUSTED";
  message?: string;
  roundId?: string;
  candidate?: {
    id: string;
    question: { id: string; questionRevisionId: string; text: string };
  };
};

function parseConversation(value: unknown): ConversationProjection | null {
  if (!value || typeof value !== "object" || !("state" in value) || typeof value.state !== "string")
    return null;
  return value as ConversationProjection;
}

export default function PrivateConversationScreen({ view }: { view: ConversationProjection }) {
  const router = useRouter();
  const [conversation, setConversation] = useState(view);
  const [isAsking, setIsAsking] = useState(false);
  const [optimisticAskQuestion, setOptimisticAskQuestion] = useState<
    NonNullable<ConversationProjection["candidate"]>["question"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setConversation(view), [view]);
  const question = conversation.candidate?.question.text;
  const candidateBaseUrl = conversation.candidate
    ? `/api/pairs/${encodeURIComponent(conversation.pairId)}/private-conversations/${encodeURIComponent(conversation.id)}/candidates/${encodeURIComponent(conversation.candidate.id)}`
    : null;
  const conversationUrl = `/api/pairs/${encodeURIComponent(conversation.pairId)}/private-conversations/${encodeURIComponent(conversation.id)}`;
  const conversationQuery = useQuery({
    queryKey: closerKeys.privateConversation(view.pairId, view.id),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/pairs/${encodeURIComponent(view.pairId)}/private-conversations/${encodeURIComponent(view.id)}`,
        { cache: "no-store", signal },
      );
      const next = response.ok ? parseConversation(await response.json()) : null;
      if (!next) throw new Error("Unable to refresh Private conversation.");
      return next;
    },
    initialData: view,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (conversationQuery.data) setConversation(conversationQuery.data);
  }, [conversationQuery.data]);

  async function reconcileConversation() {
    try {
      const response = await fetch(conversationUrl, { cache: "no-store" });
      const next = response.ok ? parseConversation(await response.json()) : null;
      if (!next) return null;
      setConversation(next);
      return next;
    } catch {
      return null;
    }
  }

  async function askQuestion() {
    if (!candidateBaseUrl) return;
    const candidate = conversation.candidate;
    if (!candidate) return;
    setError(null);
    setIsAsking(true);
    // This uses the exact question occurrence already authorized for the creator;
    // it never selects or serializes another candidate while Ask is in flight.
    setOptimisticAskQuestion(candidate.question);
    try {
      const response = await fetch(`${candidateBaseUrl}/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRequestId: crypto.randomUUID() }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        !("roundId" in result) ||
        typeof result.roundId !== "string"
      )
        throw new Error();
      router.push(`/pair/${view.pairId}/private/round/${result.roundId}` as never);
    } catch {
      setOptimisticAskQuestion(null);
      const authoritative = await reconcileConversation();
      if (authoritative?.state === "CURRENT_ROUND" && authoritative.roundId) {
        router.replace(
          `/pair/${authoritative.pairId}/private/round/${authoritative.roundId}` as never,
        );
        return;
      }
      setError("We couldn’t ask that question. Please try again.");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <CloserPageShell className="pt-5">
      <CloserBackLink href={`/pair/${conversation.pairId}`} />
      <section className="pt-10">
        <ModeBadge mode="private" />
        <p className="text-closer-muted mt-6 text-sm font-extrabold tracking-[.16em] uppercase">
          {conversation.category}
        </p>
        {optimisticAskQuestion ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-[2.25rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
              {optimisticAskQuestion.text}
            </h1>
            <p className="text-closer-muted mt-4 max-w-[32ch] leading-relaxed">
              Your private answer space is getting ready.
            </p>
            <div
              className="shadow-closer-soft mt-8 rounded-[1.35rem] bg-white/70 p-4"
              aria-busy="true"
            >
              <label className="text-sm font-extrabold" htmlFor="optimistic-private-answer">
                Your answer
              </label>
              <Textarea
                className="mt-3 min-h-28"
                disabled
                id="optimistic-private-answer"
                placeholder="Your answer"
              />
              <Button className="mt-3 w-full" disabled size="lg" type="button">
                Share your answer
              </Button>
            </div>
          </>
        ) : conversation.state === "CANDIDATE" && question ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-[2.25rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
              {question}
            </h1>
            <p className="text-closer-muted mt-4 max-w-[32ch] leading-relaxed">
              Choose a question to answer together, in your own words.
            </p>
            <div className="mt-8 grid gap-3">
              <AsyncButton
                onClick={() => void askQuestion()}
                pending={isAsking}
                pendingText="Opening…"
                size="lg"
                type="button"
              >
                Choose this question
              </AsyncButton>
            </div>
            {error ? <ActionError>{error}</ActionError> : null}
          </>
        ) : conversation.state === "READY_FOR_NEXT" ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-[2.25rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
              Choose the next question
            </h1>
            <p className="text-closer-muted mt-4 max-w-[32ch] leading-relaxed">
              You can continue once you&apos;re ready.
            </p>
            <Link
              className={cn(buttonVariants({ size: "lg" }), "mt-8")}
              href={`/pair/${conversation.pairId}/private` as never}
              prefetch
            >
              Choose next question
            </Link>
          </>
        ) : conversation.state === "EXHAUSTED" ? (
          <h1 className="mt-4 max-w-[18ch] text-[2.25rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
            You&apos;ve reached the end for now.
          </h1>
        ) : (
          <h1 className="mt-4 max-w-[18ch] text-[2.25rem] leading-tight font-extrabold tracking-[-.048em] text-balance">
            {conversation.message ?? "Choose a category whenever it feels right."}
          </h1>
        )}
      </section>
    </CloserPageShell>
  );
}
