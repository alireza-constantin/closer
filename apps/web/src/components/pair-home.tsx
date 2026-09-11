"use client";

import { ChevronRight, LockKeyhole, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@Closer/ui/components/empty";
import { cn } from "@Closer/ui/lib/utils";

import { CloserCompanions, CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { CloserModeCard } from "@/components/closer/navigation";
import { CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";
import { useVisiblePolling } from "@/hooks/use-visible-polling";

export const ACTIVE_CONVERSATIONS_POLL_INTERVAL_MS = 3_500;

type ActiveConversation = {
  id: string;
  category: string;
  questionCount: number;
  currentRound: { id: string; question: { text: string; category: string; depth: string } };
  otherParticipantDisplayName: string;
  state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "READY_FOR_NEXT";
};

function parseActiveConversations(value: unknown): ActiveConversation[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((conversation) => (
    conversation && typeof conversation === "object"
    && "id" in conversation && typeof conversation.id === "string"
    && "category" in conversation && typeof conversation.category === "string"
    && "questionCount" in conversation && typeof conversation.questionCount === "number"
    && "state" in conversation && ["YOUR_TURN", "WAITING", "REVEAL_READY", "READY_FOR_NEXT"].includes(String(conversation.state))
    && "currentRound" in conversation && conversation.currentRound && typeof conversation.currentRound === "object"
    && "id" in conversation.currentRound && typeof conversation.currentRound.id === "string"
    && "question" in conversation.currentRound && conversation.currentRound.question && typeof conversation.currentRound.question === "object"
    && "text" in conversation.currentRound.question && typeof conversation.currentRound.question.text === "string"
    && "otherParticipantDisplayName" in conversation && typeof conversation.otherParticipantDisplayName === "string"
  )) ? value as ActiveConversation[] : null;
}

function sameConversations(current: ActiveConversation[], next: ActiveConversation[]) {
  return current.length === next.length && current.every((conversation, index) => {
    const candidate = next[index];
    return candidate
      && conversation.id === candidate.id
      && conversation.state === candidate.state
      && conversation.questionCount === candidate.questionCount
      && conversation.currentRound.id === candidate.currentRound.id
      && conversation.currentRound.question.text === candidate.currentRound.question.text;
  });
}

function statusCopy(conversation: ActiveConversation) {
  if (conversation.state === "YOUR_TURN") return "Your turn";
  if (conversation.state === "WAITING") return `Waiting for ${conversation.otherParticipantDisplayName}`;
  if (conversation.state === "REVEAL_READY") return "Ready to reveal";
  return "Ready for next question";
}

function categoryTitle(category: string) {
  return category.slice(0, 1).toUpperCase() + category.slice(1);
}

const stateDotClasses: Record<ActiveConversation["state"], string> = {
  YOUR_TURN: "bg-closer-coral",
  WAITING: "bg-closer-warning",
  REVEAL_READY: "bg-closer-lavender",
  READY_FOR_NEXT: "bg-closer-success",
};

function ConversationCard({ pairId, conversation }: { pairId: string; conversation: ActiveConversation }) {
  return (
    <Link className="group grid grid-cols-[12px_1fr_auto] items-center gap-2.5 rounded-[1.05rem] bg-white/85 px-3 py-3 text-closer-navy no-underline shadow-closer-soft transition-transform duration-200 hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-closer-navy focus-visible:ring-offset-2 focus-visible:ring-offset-closer-cream" href={`/pair/${pairId}/private/round/${conversation.currentRound.id}` as never}>
      <span aria-hidden="true" className={cn("size-2.5 rounded-full", stateDotClasses[conversation.state])} />
      <span className="min-w-0">
        <strong className="block text-sm font-extrabold">{categoryTitle(conversation.category)}</strong>
        <small className="mt-0.5 block text-xs leading-relaxed text-closer-muted">{statusCopy(conversation)} · {conversation.questionCount} {conversation.questionCount === 1 ? "question" : "questions"}</small>
        <small className="mt-0.5 block truncate text-xs leading-relaxed text-closer-muted">“{conversation.currentRound.question.text}”</small>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function PairHome({
  pairId,
  memberNames,
  isComplete,
  activeConversations: initialActiveConversations,
}: {
  pairId: string;
  memberNames: [string, string | null];
  isComplete: boolean;
  activeConversations: ActiveConversation[];
}) {
  const [activeConversations, setActiveConversations] = useState(initialActiveConversations);

  useVisiblePolling({
    intervalMs: ACTIVE_CONVERSATIONS_POLL_INTERVAL_MS,
    onPoll: async (signal) => {
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/private-conversations`, { cache: "no-store", signal });
        const next = response.ok ? parseActiveConversations(await response.json()) : null;
        if (next) setActiveConversations((current) => sameConversations(current, next) ? current : next);
      } catch {
        // A transient foreground refresh must not remove visible conversations.
      }
    },
  });

  return (
    <CloserPageShell>
      <CloserTopbar href={`/pair/${pairId}`} />
      <section className="pb-7 pt-8 text-center">
        <CloserCompanions />
        <CloserPageTitle>{isComplete ? `${memberNames[0]} + ${memberNames[1] ?? "your person"}` : `${memberNames[0]} + your person`}</CloserPageTitle>
        <CloserSubtitle>What do you feel like doing?</CloserSubtitle>
      </section>
      <section className="grid gap-3" aria-label="Choose a way to connect">
        <CloserModeCard href={`/pair/${pairId}/together`} kind="together" icon={<MessageCircleMore aria-hidden="true" />} title="Talk Together" description="Use this phone and talk face-to-face" />
        <CloserModeCard href={`/pair/${pairId}/private`} kind="private" icon={<LockKeyhole aria-hidden="true" />} title="Answer Privately" description={isComplete ? "Answer separately, reveal together" : "Connect your person to answer on two phones"} />
      </section>
      {activeConversations.length > 0 ? (
        <section className="mt-8" aria-labelledby="private-conversations-heading">
          <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-[-.025em]" id="private-conversations-heading">Your conversations</h2>
          <div className="grid gap-2.5">
            {activeConversations.map((conversation) => <ConversationCard conversation={conversation} key={conversation.id} pairId={pairId} />)}
          </div>
        </section>
      ) : (
        <Empty className="my-9 gap-2 rounded-[1.375rem] bg-white/55 px-6 py-7 text-closer-muted">
          <EmptyHeader className="gap-2">
            <EmptyMedia className="mb-0 text-closer-coral" variant="default"><Sparkles aria-hidden="true" /></EmptyMedia>
            <span className="sr-only">No private conversations yet</span>
            <EmptyDescription className="max-w-[29ch] leading-relaxed">Your private conversations will live here when you start one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {isComplete ? <Link className="mx-auto mt-6 block w-fit text-xs text-closer-muted underline-offset-4 hover:text-closer-navy hover:underline" href={`/pair/${pairId}/rejoin` as never}>Need to reconnect your person?</Link> : null}
    </CloserPageShell>
  );
}
