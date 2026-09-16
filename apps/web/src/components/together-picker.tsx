"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionError } from "@/components/closer/feedback";
import { CategoryCard, categoriesForRelationship, type CloserCategory } from "@/components/closer/category";
import { CloserBackLink } from "@/components/closer/navigation";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserPageShell, CloserWordmark } from "@/components/closer/page-shell";
import { CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";

export default function TogetherPicker({ pairId, relationshipType }: { pairId: string; relationshipType: "partner" | "friend" }) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState<CloserCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<CloserCategory, string>());
  const categories = categoriesForRelationship(relationshipType);

  async function startCategory(category: CloserCategory) {
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
      if (!response.ok || !body || typeof body !== "object" || !("sessionId" in body) || typeof body.sessionId !== "string") throw new Error();
      requestIds.current.delete(category);
      router.push(`/pair/${pairId}/together/${body.sessionId}` as never);
    } catch {
      setError("We couldn’t start that conversation right now. Please try again.");
    } finally {
      setIsStarting(null);
    }
  }

  return (
    <CloserPageShell className="pt-[18px]">
      <header className="flex min-h-[42px] items-center justify-between gap-3">
        <CloserBackLink href={`/pair/${pairId}`} label="Back to pair home" />
        <CloserWordmark />
        <ModeBadge mode="together" />
      </header>
      <section className="pt-7">
        <CloserPageTitle>What kind of conversation?</CloserPageTitle>
        <CloserSubtitle>Choose a topic, then put the phone between you and talk.</CloserSubtitle>
        <div className="mt-5 grid gap-2.5">
          {categories.map((category) => <CategoryCard category={category} compact disabled={isStarting !== null} key={category} mode="together" onClick={() => void startCategory(category)} pending={isStarting === category} />)}
        </div>
      </section>
      {error ? <ActionError>{error}</ActionError> : null}
    </CloserPageShell>
  );
}
