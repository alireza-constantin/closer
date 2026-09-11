"use client";

import { ArrowLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Category = "fun" | "deep" | "memories" | "relationship" | "friendship";

const categoryCopy: Record<Category, { title: string; description: string }> = {
  fun: { title: "Fun", description: "A little lighter, a little playful" },
  deep: { title: "Deep", description: "Thoughtful questions worth lingering on" },
  memories: { title: "Memories", description: "Moments you’ve shared" },
  relationship: { title: "Relationship", description: "For the two of you" },
  friendship: { title: "Friendship", description: "For the way you show up" },
};

export default function PrivatePicker({ pairId, relationshipType }: { pairId: string; relationshipType: "partner" | "friend" }) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<Category, string>());
  const categories: Category[] = relationshipType === "partner"
    ? ["fun", "deep", "memories", "relationship"]
    : ["fun", "deep", "memories", "friendship"];

  async function openCategory(category: Category) {
    setError(null);
    setIsStarting(category);
    const clientRequestId = requestIds.current.get(category) ?? crypto.randomUUID();
    requestIds.current.set(category, clientRequestId);
    try {
      const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/private-conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, clientRequestId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("roundId" in body) || typeof body.roundId !== "string") throw new Error();
      requestIds.current.delete(category);
      router.push(`/pair/${pairId}/private/round/${body.roundId}` as never);
    } catch {
      setError("We couldn’t open that conversation right now. Please try again.");
    } finally {
      setIsStarting(null);
    }
  }

  return (
    <main className="closer-shell closer-task-shell">
      <button className="closer-back-button" onClick={() => router.push(`/pair/${pairId}` as never)} type="button">
        <ArrowLeft aria-hidden="true" /><span>Back</span>
      </button>
      <section className="closer-picker-intro">
        <span className="closer-private-pill"><LockKeyhole aria-hidden="true" /> Private</span>
        <h1>What kind of question feels right?</h1>
        <p>Choose a topic. We’ll bring you back to it whenever you want.</p>
        <div className="closer-category-grid">
          {categories.map((category) => (
            <button className={`closer-category closer-category-${category}`} disabled={isStarting !== null} key={category} onClick={() => void openCategory(category)} type="button">
              <span>{categoryCopy[category].title}</span><small>{categoryCopy[category].description}</small>
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
