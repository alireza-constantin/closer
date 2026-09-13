"use client";

import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { useEffect, useState } from "react";

import { AsyncButton } from "@/components/closer/async-button";
import { ActionError } from "@/components/closer/feedback";
import { CloserBackButton } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ModeBadge } from "@/components/closer/mode-badge";

type ConversationProjection = {
  id: string;
  pairId: string;
  category: string;
  creator: { displayName: string };
  role: "creator" | "non-creator";
  state: "CANDIDATE" | "WAITING_FOR_CREATOR" | "EXHAUSTED";
  message?: string;
  candidate?: { id: string; liked: boolean; question: { text: string } };
};

export default function PrivateConversationScreen({ view }: { view: ConversationProjection }) {
  const router = useRouter();
  const [liked, setLiked] = useState(view.candidate?.liked ?? false);
  const [isAsking, setIsAsking] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLiked(view.candidate?.liked ?? false), [view.candidate?.id, view.candidate?.liked]);
  const question = view.candidate?.question.text;
  const candidateBaseUrl = view.candidate
    ? `/api/pairs/${encodeURIComponent(view.pairId)}/private-conversations/${encodeURIComponent(view.id)}/candidates/${encodeURIComponent(view.candidate.id)}`
    : null;

  async function likeQuestion() {
    if (!candidateBaseUrl) return;
    const nextLiked = !liked;
    setError(null);
    setIsLiking(true);
    try {
      const response = await fetch(`${candidateBaseUrl}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ liked: nextLiked }) });
      if (!response.ok) throw new Error();
      setLiked(nextLiked);
    } catch {
      setError("We couldn’t save that Like. Please try again.");
    } finally {
      setIsLiking(false);
    }
  }

  async function askQuestion() {
    if (!candidateBaseUrl) return;
    setError(null);
    setIsAsking(true);
    try {
      const response = await fetch(`${candidateBaseUrl}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("roundId" in result) || typeof result.roundId !== "string") throw new Error();
      router.push(`/pair/${view.pairId}/private/round/${result.roundId}` as never);
    } catch {
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
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setError("We couldn’t skip that question. Please try again.");
    } finally {
      setIsSkipping(false);
    }
  }
  return (
    <CloserPageShell className="pt-5">
      <CloserBackButton onClick={() => router.push(`/pair/${view.pairId}` as never)} />
      <section className="pt-10">
        <ModeBadge mode="private" />
        <p className="mt-6 text-sm font-extrabold uppercase tracking-[.16em] text-closer-muted">{view.category}</p>
        {view.state === "CANDIDATE" && question ? (
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
        ) : view.state === "EXHAUSTED" ? (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">You&apos;ve reached the end for now.</h1>
        ) : (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{view.message ?? `Waiting for ${view.creator.displayName} to choose a question.`}</h1>
        )}
      </section>
    </CloserPageShell>
  );
}
