"use client";

import { ArrowLeft, Heart, LockKeyhole, MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RoundView = {
  id: string;
  pairId: string;
  conversation: { id: string; category: string; questionNumber: number };
  question: { id: string; text: string; category: string; depth: string };
  otherParticipant: { id: string; displayName: string };
  yourAnswer: string | null;
  state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED";
  revealViewedAt: string | null;
  answers?: Array<{ participantId: string; displayName: string; body: string }>;
  reactions?: Array<{ participantId: string; displayName: string; value: ReactionValue }>;
  replies?: Array<{ participantId: string; displayName: string; body: string; isOwner: boolean }>;
};
type ReactionValue = "heart" | "laugh" | "tender" | "surprised";

const reactions: Array<{ value: ReactionValue; label: string; glyph: string }> = [
  { value: "heart", label: "Love", glyph: "❤️" },
  { value: "laugh", label: "Laugh", glyph: "😂" },
  { value: "tender", label: "Tender", glyph: "🥺" },
  { value: "surprised", label: "Surprised", glyph: "😮" },
];

function parseRound(value: unknown): RoundView | null {
  if (!value || typeof value !== "object" || !("state" in value) || typeof value.state !== "string") return null;
  return value as RoundView;
}

export default function PrivateRoundScreen({ initialRound }: { initialRound: RoundView }) {
  const router = useRouter();
  const [round, setRound] = useState(initialRound);
  const [answer, setAnswer] = useState(initialRound.yourAnswer ?? "");
  const [reply, setReply] = useState(() => initialRound.replies?.find((item) => item.isOwner)?.body ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isSavingReply, setIsSavingReply] = useState(false);
  const [isStartingNext, setIsStartingNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = `/api/pairs/${encodeURIComponent(round.pairId)}/private-rounds/${encodeURIComponent(round.id)}`;

  useEffect(() => {
    if (round.state !== "WAITING") return;
    let disposed = false;
    let timer: number | null = null;
    let activeRequest: AbortController | null = null;

    async function checkStatus() {
      if (disposed || document.visibilityState !== "visible" || activeRequest) return;
      const request = new AbortController();
      activeRequest = request;
      try {
        const response = await fetch(`${baseUrl}/status`, { cache: "no-store", signal: request.signal });
        const next = parseRound(await response.json());
        if (!disposed && next?.state === "REVEAL_READY") setRound((current) => ({ ...current, state: "REVEAL_READY" }));
      } catch {
        // A transient status failure leaves the calm waiting state intact until the next visible poll.
      } finally {
        if (activeRequest === request) activeRequest = null;
      }
    }
    function start() {
      if (document.visibilityState !== "visible" || timer !== null) return;
      void checkStatus();
      timer = window.setInterval(() => void checkStatus(), 4_000);
    }
    function stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      activeRequest?.abort();
      activeRequest = null;
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void checkStatus();
        start();
      } else stop();
    }
    function onFocus() { void checkStatus(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    start();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [baseUrl, round.state]);

  useEffect(() => {
    if (round.state !== "REVEAL_VIEWED") return;
    let disposed = false;
    let timer: number | null = null;
    let activeRequest: AbortController | null = null;

    async function refreshInteractions() {
      if (disposed || document.visibilityState !== "visible" || activeRequest) return;
      const request = new AbortController();
      activeRequest = request;
      try {
        const response = await fetch(baseUrl, { cache: "no-store", signal: request.signal });
        const next = response.ok ? parseRound(await response.json()) : null;
        if (!disposed && next?.state === "REVEAL_VIEWED" && next.answers) setRound(next);
      } catch {
        // Keep the revealed conversation calm through a transient foreground refresh failure.
      } finally {
        if (activeRequest === request) activeRequest = null;
      }
    }

    function start() {
      if (document.visibilityState !== "visible" || timer !== null) return;
      void refreshInteractions();
      timer = window.setInterval(() => void refreshInteractions(), 4_000);
    }
    function stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      activeRequest?.abort();
      activeRequest = null;
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refreshInteractions();
        start();
      } else stop();
    }
    function onFocus() { void refreshInteractions(); }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    start();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [baseUrl, round.state]);

  async function submitAnswer() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`${baseUrl}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: answer }),
      });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      setError("Your answer needs 1–2,000 characters. Nothing was saved—please try again.");
    } finally {
      setIsSubmitting(false);
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

  async function updateReaction(value: ReactionValue) {
    const selected = round.reactions?.find((item) => item.participantId !== round.otherParticipant.id)?.value;
    try {
      const response = await fetch(`${baseUrl}/reaction`, selected === value ? { method: "DELETE" } : {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }),
      });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      setError("We couldn’t save that reaction. Please try again.");
    }
  }

  async function saveReply() {
    setError(null);
    setIsSavingReply(true);
    try {
      const response = await fetch(`${baseUrl}/reply`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: reply }),
      });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
    } catch {
      setError("Replies need 1–500 characters. Please try again.");
    } finally {
      setIsSavingReply(false);
    }
  }

  async function removeReply() {
    try {
      const response = await fetch(`${baseUrl}/reply`, { method: "DELETE" });
      const next = parseRound(await response.json());
      if (!response.ok || !next) throw new Error();
      setRound(next);
      setReply("");
    } catch {
      setError("We couldn’t remove that reply. Please try again.");
    }
  }

  async function startNextQuestion() {
    setError(null);
    setIsStartingNext(true);
    const clientRequestId = crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/pairs/${encodeURIComponent(round.pairId)}/private-conversations/${encodeURIComponent(round.conversation.id)}/next`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientRequestId }),
        },
      );
      const next: unknown = await response.json();
      if (!response.ok || !next || typeof next !== "object" || !("roundId" in next) || typeof next.roundId !== "string") throw new Error();
      router.push(`/pair/${round.pairId}/private/round/${next.roundId}` as never);
    } catch {
      setError("We couldn’t start the next question. Please try again.");
    } finally {
      setIsStartingNext(false);
    }
  }

  const header = (
    <header className="closer-round-header">
      <button aria-label="Back to pair" className="closer-icon-button" onClick={() => router.push(`/pair/${round.pairId}` as never)} type="button"><ArrowLeft aria-hidden="true" /></button>
      <span className="closer-private-pill"><LockKeyhole aria-hidden="true" /> Private</span>
      <span className="closer-round-space" />
    </header>
  );

  if (round.state === "YOUR_TURN") {
    return <main className="closer-shell closer-task-shell">{header}<section className="closer-answer-screen">
      <span className={`closer-category-pill closer-category-${round.question.category}`}>{round.question.category}</span>
      <p className="closer-conversation-context">{round.question.category} · Question {round.conversation.questionNumber}</p>
      <h1>“{round.question.text}”</h1>
      <textarea aria-describedby="private-answer-help" className="closer-answer-input" maxLength={2000} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer…" value={answer} />
      <button className="closer-primary-button closer-wide-button" disabled={isSubmitting || answer.trim().length === 0} onClick={() => void submitAnswer()} type="button">{isSubmitting ? "Saving…" : "Save my answer"}</button>
      <p id="private-answer-help" className="closer-safe-note"><LockKeyhole aria-hidden="true" /> {round.otherParticipant.displayName} won’t see your answer yet.</p>
    </section>{error ? <p className="closer-form-error" role="alert">{error}</p> : null}</main>;
  }

  if (round.state === "WAITING") {
    return <main className="closer-shell closer-task-shell">{header}<section className="closer-waiting-screen">
      <div className="closer-companions closer-waiting-companions" aria-hidden="true"><span className="closer-companion closer-companion-coral">•‿•</span><span className="closer-companion closer-companion-lavender">⌣⌣</span></div>
      <h1>Answer saved</h1><h2>Waiting for {round.otherParticipant.displayName}</h2>
      <p>You’ll both see your answers when {round.otherParticipant.displayName} responds.</p>
      <div className="closer-continuation-actions">
        <button className="closer-text-button" onClick={() => router.push(`/pair/${round.pairId}` as never)} type="button">Back to Closer</button>
        <button className="closer-text-button" onClick={() => router.push(`/pair/${round.pairId}/private` as never)} type="button">Choose another topic</button>
      </div>
    </section></main>;
  }

  if (round.state === "REVEAL_READY") {
    return <main className="closer-shell closer-task-shell">{header}<section className="closer-ready-screen">
      <Heart aria-hidden="true" className="closer-ready-heart" fill="currentColor" />
      <p className="closer-conversation-context">{round.question.category} · Question {round.conversation.questionNumber}</p>
      <h1>Your answers are ready</h1><p>Two perspectives, waiting to be shared.</p>
      <button className="closer-primary-button closer-wide-button" disabled={isRevealing} onClick={() => void reveal()} type="button">{isRevealing ? "Opening…" : "Reveal"}</button>
    </section>{error ? <p className="closer-form-error" role="alert">{error}</p> : null}</main>;
  }

  const selectedReaction = round.reactions?.find((item) => item.participantId !== round.otherParticipant.id)?.value;
  const ownReply = round.replies?.find((item) => item.isOwner);
  return <main className="closer-shell closer-task-shell">{header}<section className="closer-reveal-screen">
    <p className="closer-conversation-context">{round.question.category} · Question {round.conversation.questionNumber}</p>
    <h1>Your answers</h1><p>Two perspectives. A closer us.</p>
    <div className="closer-answer-cards">
      {round.answers?.map((item) => {
        const partnerReaction = round.reactions?.find((reaction) => reaction.participantId !== item.participantId);
        const reactionGlyph = reactions.find((reaction) => reaction.value === partnerReaction?.value)?.glyph;
        return <article className={`closer-revealed-answer ${item.participantId === round.otherParticipant.id ? "closer-answer-lavender" : "closer-answer-coral"}`} key={item.participantId}>
          <span className="closer-answer-avatar" aria-hidden="true">{item.displayName.slice(0, 1)}</span><div><h2>{item.displayName}</h2><p>{item.body}</p></div>
          {reactionGlyph ? <span className="closer-answer-reaction" aria-label={`${partnerReaction?.displayName} reacted`}>{reactionGlyph}</span> : null}
        </article>;
      })}
    </div>
    <div className="closer-reactions" aria-label={`Choose your reaction to ${round.otherParticipant.displayName}'s answer`}>{reactions.map((reaction) => <button aria-label={reaction.label} className={selectedReaction === reaction.value ? "is-selected" : ""} key={reaction.value} onClick={() => void updateReaction(reaction.value)} type="button">{reaction.glyph}</button>)}</div>
    <div className="closer-reply-area">
      <label htmlFor="private-reply"><MessageCircle aria-hidden="true" /> Reply to {round.otherParticipant.displayName}</label>
      <textarea id="private-reply" maxLength={500} onChange={(event) => setReply(event.target.value)} placeholder={`Share a short thought with ${round.otherParticipant.displayName}…`} value={reply} />
      <div><button className="closer-primary-button" disabled={isSavingReply || reply.trim().length === 0} onClick={() => void saveReply()} type="button"><Send aria-hidden="true" />{isSavingReply ? "Saving…" : ownReply ? "Save reply" : "Add reply"}</button>{ownReply ? <button className="closer-text-button" onClick={() => void removeReply()} type="button">Remove</button> : null}</div>
    </div>
    {round.replies?.filter((item) => !item.isOwner).map((item) => <p className="closer-other-reply" key={item.participantId}><strong>{item.displayName}</strong> {item.body}</p>)}
    <button className="closer-secondary-button closer-next-question" disabled={isStartingNext} onClick={() => void startNextQuestion()} type="button">{isStartingNext ? "Starting…" : "Next question"}</button>
    <button className="closer-text-button" onClick={() => router.push(`/pair/${round.pairId}` as never)} type="button">Back to Closer</button>
  </section>{error ? <p className="closer-form-error" role="alert">{error}</p> : null}</main>;
}
