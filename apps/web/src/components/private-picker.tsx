"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CategoryCard, categoriesForRelationship, type CloserCategory } from "@/components/closer/category";
import { CloserBackButton } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ActionError } from "@/components/closer/feedback";
import { ModeBadge } from "@/components/closer/mode-badge";

export default function PrivatePicker({ pairId, relationshipType }: { pairId: string; relationshipType: "partner" | "friend" }) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState<CloserCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<CloserCategory, string>());
  const categories = categoriesForRelationship(relationshipType);

  async function openCategory(category: CloserCategory) {
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
      if (!response.ok || !body || typeof body !== "object" || !("conversationId" in body) || typeof body.conversationId !== "string") throw new Error();
      requestIds.current.delete(category);
      const destination = "roundId" in body && typeof body.roundId === "string"
        ? `/pair/${pairId}/private/round/${body.roundId}`
        : `/pair/${pairId}/private/conversation/${body.conversationId}`;
      router.push(destination as never);
    } catch {
      setError("We couldn’t open that conversation right now. Please try again.");
    } finally {
      setIsStarting(null);
    }
  }

  return (
    <CloserPageShell className="pt-5">
      <CloserBackButton onClick={() => router.push(`/pair/${pairId}` as never)} />
      <section className="pt-10">
        <ModeBadge mode="private" />
        <h1 className="mt-6 max-w-[12ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">What kind of question feels right?</h1>
        <p className="mt-3 max-w-[32ch] leading-relaxed text-closer-muted">Choose a topic. We’ll bring you back to it whenever you want.</p>
        <div className="mt-6 grid gap-2.5">
          {categories.map((category) => <CategoryCard category={category} disabled={isStarting !== null} key={category} mode="private" onClick={() => void openCategory(category)} pending={isStarting === category} />)}
        </div>
      </section>
      {error ? <ActionError>{error}</ActionError> : null}
    </CloserPageShell>
  );
}
