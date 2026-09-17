"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@Closer/ui/components/button";
import { Textarea } from "@Closer/ui/components/textarea";
import { cn } from "@Closer/ui/lib/utils";

import { AsyncButton } from "@/components/closer/async-button";
import { ActionError } from "@/components/closer/feedback";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ModeBadge } from "@/components/closer/mode-badge";

type ConversationProjection = {
  id: string;
  pairId: string;
  category: string;
  creator: { displayName: string };
  role: "creator" | "non-creator";
  state: "CANDIDATE" | "CURRENT_ROUND" | "READY_FOR_NEXT" | "WAITING_FOR_CREATOR" | "EXHAUSTED";
  message?: string;
  roundId?: string;
  candidate?: { id: string; liked: boolean; question: { id: string; questionRevisionId: string; text: string } };
};

function parseConversation(value: unknown): ConversationProjection | null {
  if (!value || typeof value !== "object" || !("state" in value) || typeof value.state !== "string") return null;
  return value as ConversationProjection;
}

export default function PrivateConversationScreen({ view }: { view: ConversationProjection }) {
  const router = useRouter();
  const [conversation, setConversation] = useState(view);
  const [liked, setLiked] = useState(view.candidate?.liked ?? false);
  const [isAsking, setIsAsking] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [optimisticAskQuestion, setOptimisticAskQuestion] = useState<NonNullable<ConversationProjection["candidate"]>["question"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentCandidateIdRef = useRef(conversation.candidate?.id);
  currentCandidateIdRef.current = conversation.candidate?.id;
  useEffect(() => setConversation(view), [view]);
  useEffect(() => setLiked(conversation.candidate?.liked ?? false), [conversation.candidate?.id, conversation.candidate?.liked]);
  const question = conversation.candidate?.question.text;
  const candidateBaseUrl = conversation.candidate
    ? `/api/pairs/${encodeURIComponent(conversation.pairId)}/private-conversations/${encodeURIComponent(conversation.id)}/candidates/${encodeURIComponent(conversation.candidate.id)}`
    : null;
  const conversationUrl = `/api/pairs/${encodeURIComponent(conversation.pairId)}/private-conversations/${encodeURIComponent(conversation.id)}`;

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

  async function likeQuestion() {
    if (!candidateBaseUrl) return;
    const nextLiked = !liked;
    const candidateId = conversation.candidate?.id;
    setError(null);
    setLiked(nextLiked);
    setIsLiking(true);
    try {
      const response = await fetch(`${candidateBaseUrl}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ liked: nextLiked }) });
      if (!response.ok) throw new Error();
    } catch {
      const authoritative = await reconcileConversation();
      if (!authoritative && currentCandidateIdRef.current === candidateId) setLiked(!nextLiked);
      setError("We couldn’t save that Like. Please try again.");
    } finally {
      setIsLiking(false);
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
      const response = await fetch(`${candidateBaseUrl}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("roundId" in result) || typeof result.roundId !== "string") throw new Error();
      router.push(`/pair/${view.pairId}/private/round/${result.roundId}` as never);
    } catch {
      setOptimisticAskQuestion(null);
      const authoritative = await reconcileConversation();
      if (authoritative?.state === "CURRENT_ROUND" && authoritative.roundId) {
        router.replace(`/pair/${authoritative.pairId}/private/round/${authoritative.roundId}` as never);
        return;
      }
      setError("We couldn’t ask that question. Please try again.");
    } finally {
      setIsAsking(false);
    }
  }

  async function skipQuestion() {
    if (!candidateBaseUrl) return;
    setError(null);
    setIsSkipping(true);
    try {
      const response = await fetch(`${candidateBaseUrl}/skip`, { method: "POST" });
      const next = parseConversation(await response.json());
      if (!response.ok || !next) throw new Error();
      // The server selects and persists the next candidate before it is returned.
      // Nothing future is kept in the client before this response arrives.
      setConversation(next);
    } catch {
      // A timeout can mean the server committed Skip but its response was lost.
      // The focused, viewer-relative projection corrects that stale candidate.
      await reconcileConversation();
      setError("We couldn’t skip that question. Please try again.");
    } finally {
      setIsSkipping(false);
    }
  }
  return (
    <CloserPageShell className="pt-5">
      <CloserBackLink href={`/pair/${conversation.pairId}`} />
      <section className="pt-10">
        <ModeBadge mode="private" />
        <p className="mt-6 text-sm font-extrabold uppercase tracking-[.16em] text-closer-muted">{conversation.category}</p>
        {optimisticAskQuestion ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{optimisticAskQuestion.text}</h1>
            <p className="mt-4 max-w-[32ch] leading-relaxed text-closer-muted">Your private answer space is getting ready.</p>
            <div className="mt-8 rounded-[1.35rem] bg-white/70 p-4 shadow-closer-soft" aria-busy="true">
              <label className="text-sm font-extrabold" htmlFor="optimistic-private-answer">Your answer</label>
              <Textarea className="mt-3 min-h-28" disabled id="optimistic-private-answer" placeholder="Your answer" />
              <Button className="mt-3 w-full" disabled size="lg" type="button">Share your answer</Button>
            </div>
          </>
        ) : conversation.state === "CANDIDATE" && question ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{question}</h1>
            <p className="mt-4 max-w-[32ch] leading-relaxed text-closer-muted">This question is waiting for you to choose what happens next.</p>
            <div className="mt-8 grid gap-3">
              <AsyncButton onClick={() => void askQuestion()} pending={isAsking} pendingText="Asking…" size="lg" type="button">Ask this question</AsyncButton>
              <div className="grid grid-cols-2 gap-3">
                <AsyncButton aria-pressed={liked} onClick={() => void likeQuestion()} pending={isLiking} pendingText="Saving…" size="lg" type="button" variant={liked ? "secondary" : "outline"}><Heart aria-hidden="true" className="size-4" fill={liked ? "currentColor" : "none"} />{liked ? "Liked" : "Like"}</AsyncButton>
                <AsyncButton onClick={() => void skipQuestion()} pending={isSkipping} pendingText="Skipping…" size="lg" type="button" variant="secondary">Skip</AsyncButton>
              </div>
            </div>
            {error ? <ActionError>{error}</ActionError> : null}
          </>
        ) : conversation.state === "READY_FOR_NEXT" ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">Choose the next question</h1>
            <p className="mt-4 max-w-[32ch] leading-relaxed text-closer-muted">You can continue once you&apos;re ready.</p>
            <Link className={cn(buttonVariants({ size: "lg" }), "mt-8")} href={`/pair/${conversation.pairId}/private` as never} prefetch>Choose next question</Link>
          </>
        ) : conversation.state === "EXHAUSTED" ? (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">You&apos;ve reached the end for now.</h1>
        ) : (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{conversation.message ?? `Waiting for ${conversation.creator.displayName} to choose a question.`}</h1>
        )}
      </section>
    </CloserPageShell>
  );
}
