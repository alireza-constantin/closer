"use client";

import { ArrowLeft, ChevronRight, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Category = "fun" | "deep" | "memories" | "relationship" | "friendship";

const categoryCopy: Record<Category, { title: string; description: string }> = {
  fun: { title: "Fun", description: "Lighter questions for brighter days" },
  deep: { title: "Deep", description: "Bigger questions for a closer you" },
  memories: { title: "Memories", description: "Look back, together" },
  relationship: { title: "Relationship", description: "About your journey together" },
  friendship: { title: "Friendship", description: "The good stuff you share" },
};

export default function TogetherPicker({
  pairId,
  relationshipType,
}: {
  pairId: string;
  relationshipType: "partner" | "friend";
}) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<Category, string>());
  const categories: Category[] = relationshipType === "partner"
    ? ["fun", "deep", "memories", "relationship"]
    : ["fun", "deep", "memories", "friendship"];

  async function startCategory(category: Category) {
    setError(null);
    setIsStarting(category);
    const clientRequestId = requestIds.current.get(category) ?? crypto.randomUUID();
    requestIds.current.set(category, clientRequestId);
    try {
      const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/together/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, clientRequestId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("sessionId" in body) || typeof body.sessionId !== "string") {
        throw new Error();
      }
      requestIds.current.delete(category);
      router.push(`/pair/${pairId}/together/${body.sessionId}` as never);
    } catch {
      setError("We couldn’t start that conversation right now. Please try again.");
    } finally {
      setIsStarting(null);
    }
  }

  return (
    <main className="closer-shell closer-task-shell closer-together-picker-shell">
      <header className="closer-together-header">
        <button className="closer-icon-button" onClick={() => router.push(`/pair/${pairId}` as never)} type="button">
          <ArrowLeft aria-hidden="true" /><span className="sr-only">Back to pair home</span>
        </button>
        <span className="closer-wordmark">Closer <span aria-hidden="true">♥</span></span>
        <span className="closer-together-pill"><UsersRound aria-hidden="true" /> Together</span>
      </header>
      <section className="closer-together-picker-intro">
        <h1>What kind of conversation?</h1>
        <p>Choose a topic, then put the phone between you and talk.</p>
        <div className="closer-category-grid">
          {categories.map((category) => (
            <button
              className={`closer-category closer-category-${category}`}
              disabled={isStarting !== null}
              key={category}
              onClick={() => void startCategory(category)}
              type="button"
            >
              <span>{categoryCopy[category].title}</span>
              <small>{categoryCopy[category].description}</small>
              <ChevronRight aria-hidden="true" />
              {isStarting === category ? <em>Opening…</em> : null}
            </button>
          ))}
        </div>
      </section>
      {error ? <p className="closer-form-error" role="alert">{error}</p> : null}
    </main>
  );
}
