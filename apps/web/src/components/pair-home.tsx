"use client";

import { ChevronRight, LockKeyhole, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

export default function PairHome({
  pairId,
  memberNames,
  activeConversations: initialActiveConversations,
}: {
  pairId: string;
  memberNames: [string, string];
  activeConversations: ActiveConversation[];
}) {
  const [activeConversations, setActiveConversations] = useState(initialActiveConversations);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let activeRequest: AbortController | null = null;

    async function refreshActiveConversations() {
      if (disposed || document.visibilityState !== "visible" || activeRequest) return;
      const request = new AbortController();
      activeRequest = request;
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/private-conversations`, {
          cache: "no-store",
          signal: request.signal,
        });
        const next = response.ok ? parseActiveConversations(await response.json()) : null;
        if (!disposed && next) setActiveConversations((current) => sameConversations(current, next) ? current : next);
      } catch {
        // A transient foreground refresh must not remove visible conversations.
      } finally {
        if (activeRequest === request) activeRequest = null;
      }
    }

    function start() {
      if (disposed || document.visibilityState !== "visible" || timer !== null) return;
      void refreshActiveConversations();
      timer = window.setInterval(() => void refreshActiveConversations(), ACTIVE_CONVERSATIONS_POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      activeRequest?.abort();
      activeRequest = null;
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshActiveConversations();
        start();
      } else stop();
    }
    function onFocus() { void refreshActiveConversations(); }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    start();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [pairId]);

  return (
    <main className="closer-shell">
      <header className="closer-topbar">
        <Link className="closer-wordmark" href={`/pair/${pairId}`}>
          Closer <span aria-hidden="true">♥</span>
        </Link>
        <span className="closer-pair-mark" aria-hidden="true"><i /> <i /></span>
      </header>

      <section className="closer-home-intro">
        <div className="closer-companions" aria-hidden="true">
          <span className="closer-companion closer-companion-coral">•‿•</span>
          <span className="closer-companion closer-companion-lavender">⌣⌣</span>
        </div>
        <h1>{memberNames[0]} + {memberNames[1]}</h1>
        <p>What do you feel like doing?</p>
      </section>

      <section className="closer-mode-stack" aria-label="Choose a way to connect">
        <div className="closer-mode-card closer-mode-card-together" aria-disabled="true">
          <span className="closer-mode-icon"><MessageCircleMore aria-hidden="true" /></span>
          <span><strong>Talk Together</strong><small>Questions for when you’re together</small></span>
          <span className="closer-coming-soon">Coming soon</span>
        </div>
        <Link className="closer-mode-card closer-mode-card-private" href={`/pair/${pairId}/private` as never}>
          <span className="closer-mode-icon"><LockKeyhole aria-hidden="true" /></span>
          <span><strong>Answer Privately</strong><small>Answer separately, reveal together</small></span>
          <ChevronRight aria-hidden="true" />
        </Link>
      </section>

      {activeConversations.length > 0 ? (
        <section className="closer-active-section" aria-labelledby="private-conversations-heading">
          <h2 id="private-conversations-heading">Your conversations</h2>
          <div className="closer-active-list">
            {activeConversations.map((conversation) => (
              <Link className="closer-active-item" href={`/pair/${pairId}/private/round/${conversation.currentRound.id}` as never} key={conversation.id}>
                <span className={`closer-state-dot closer-state-${conversation.state.toLowerCase()}`} aria-hidden="true" />
                <span>
                  <strong>{categoryTitle(conversation.category)}</strong>
                  <small>{statusCopy(conversation)} · {conversation.questionCount} {conversation.questionCount === 1 ? "question" : "questions"}</small>
                  <small className="closer-conversation-preview">“{conversation.currentRound.question.text}”</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="closer-empty-active"><Sparkles aria-hidden="true" /><p>Your private conversations will live here when you start one.</p></section>
      )}
    </main>
  );
}
