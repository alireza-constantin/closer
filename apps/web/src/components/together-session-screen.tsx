"use client";

import { ArrowLeft, ArrowRight, Heart, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TogetherView = {
  id: string;
  pairId: string;
  category: string;
  startedAt: string;
  endedAt: string | null;
  exhausted: boolean;
  question: {
    id: string;
    text: string;
    category: string;
    depth: string;
    position: number;
    liked: boolean;
  } | null;
};

type Action = "like" | "skip" | "next" | "end";

function parseView(value: unknown): TogetherView | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !("pairId" in value) || typeof value.pairId !== "string" || !("category" in value) || typeof value.category !== "string" || !("exhausted" in value) || typeof value.exhausted !== "boolean") {
    return null;
  }
  const question = "question" in value ? value.question : null;
  if (question !== null && (!question || typeof question !== "object" || !("id" in question) || typeof question.id !== "string" || !("text" in question) || typeof question.text !== "string" || !("liked" in question) || typeof question.liked !== "boolean")) {
    return null;
  }
  return value as TogetherView;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export default function TogetherSessionScreen({ initialSession }: { initialSession: TogetherView }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [pending, setPending] = useState<Action | null>(null);
  const [motion, setMotion] = useState<"next" | "skip" | null>(null);
  const [isEndSheetOpen, setIsEndSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = `/api/pairs/${encodeURIComponent(session.pairId)}/together/sessions/${encodeURIComponent(session.id)}`;

  async function advance(action: "next" | "skip") {
    if (pending || !session.question) return;
    setError(null);
    setPending(action);
    setMotion(action);
    try {
      const response = await fetch(`${baseUrl}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, clientRequestId: crypto.randomUUID() }),
      });
      const next = parseView(await response.json());
      if (!response.ok || !next) throw new Error();
      setSession(next);
    } catch {
      setError("That question is still here. Please try again.");
    } finally {
      setPending(null);
      window.setTimeout(() => setMotion(null), 240);
    }
  }

  async function toggleLike() {
    if (pending || !session.question) return;
    setError(null);
    setPending("like");
    try {
      const response = await fetch(`${baseUrl}/like`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liked: !session.question.liked }),
      });
      const next = parseView(await response.json());
      if (!response.ok || !next) throw new Error();
      setSession(next);
    } catch {
      setError("We couldn’t save that like. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function endSession() {
    if (pending) return;
    setPending("end");
    try {
      const response = await fetch(`${baseUrl}/end`, { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace(`/pair/${session.pairId}` as never);
    } catch {
      setError("We couldn’t end the session right now. Please try again.");
      setPending(null);
    }
  }

  return (
    <main className="closer-shell closer-together-session-shell">
      <header className="closer-together-header">
        <button className="closer-icon-button" onClick={() => router.push(`/pair/${session.pairId}` as never)} type="button">
          <ArrowLeft aria-hidden="true" /><span className="sr-only">Back to pair home</span>
        </button>
        <span className="closer-together-pill"><UsersRound aria-hidden="true" /> Together</span>
        <span className="closer-round-space" aria-hidden="true" />
      </header>

      {session.exhausted ? (
        <section className="closer-together-exhausted" aria-live="polite">
          <span className="closer-together-spark" aria-hidden="true">✦</span>
          <h1>You’ve reached the end of these questions.</h1>
          <p>That was a good little corner of the deck.</p>
          <button className="closer-primary-button" disabled={pending !== null} onClick={() => setIsEndSheetOpen(true)} type="button">End session</button>
        </section>
      ) : (
        <>
          <section className={`closer-together-question ${motion ? `is-${motion}` : ""}`} key={session.question?.id}>
            <span className={`closer-category-pill closer-category-${session.category}`}>{titleCase(session.category)}</span>
            <h1>{session.question?.text}</h1>
          </section>
          <section className="closer-together-actions" aria-label="Question actions">
            <button
              aria-pressed={session.question?.liked ?? false}
              className={`closer-together-action closer-together-like ${session.question?.liked ? "is-liked" : ""}`}
              disabled={pending !== null}
              onClick={() => void toggleLike()}
              type="button"
            >
              <span><Heart aria-hidden="true" /></span><small>Like</small>
            </button>
            <button className="closer-together-action" disabled={pending !== null} onClick={() => void advance("skip")} type="button">
              <span><X aria-hidden="true" /></span><small>Skip</small>
            </button>
            <button className="closer-together-action closer-together-next" disabled={pending !== null} onClick={() => void advance("next")} type="button">
              <span><ArrowRight aria-hidden="true" /></span><small>Next</small>
            </button>
          </section>
          <div className="closer-together-end-row">
            <button className="closer-text-button" disabled={pending !== null} onClick={() => setIsEndSheetOpen(true)} type="button">End session</button>
          </div>
        </>
      )}

      {error ? <p className="closer-form-error" role="alert">{error}</p> : null}

      {isEndSheetOpen ? (
        <div className="closer-sheet-backdrop" role="presentation" onMouseDown={() => setIsEndSheetOpen(false)}>
          <section
            aria-labelledby="end-together-heading"
            aria-modal="true"
            className="closer-end-sheet"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <span className="closer-sheet-handle" aria-hidden="true" />
            <h2 id="end-together-heading">End this session?</h2>
            <button className="closer-primary-button" disabled={pending !== null} onClick={() => void endSession()} type="button">End session</button>
            <button className="closer-secondary-button" disabled={pending !== null} onClick={() => setIsEndSheetOpen(false)} type="button">Keep talking</button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
