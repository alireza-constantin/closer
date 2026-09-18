"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionError } from "@/components/closer/feedback";
import {
  CategoryCard,
  categoriesForRelationship,
  type CloserCategory,
} from "@/components/closer/category";

export default function TogetherPicker({
  pairId,
  relationshipType,
}: {
  pairId: string;
  relationshipType: "partner" | "friend";
}) {
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
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("sessionId" in body) ||
        typeof body.sessionId !== "string"
      )
        throw new Error();
      requestIds.current.delete(category);
      router.push(`/pair/${pairId}/together/${body.sessionId}` as never);
    } catch {
      setError("We couldn’t start that conversation right now. Please try again.");
    } finally {
      setIsStarting(null);
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-2.5">
        {categories.map((category) => (
          <CategoryCard
            category={category}
            compact
            disabled={isStarting !== null}
            key={category}
            mode="together"
            onClick={() => void startCategory(category)}
            pending={isStarting === category}
          />
        ))}
      </div>
      {error ? <ActionError>{error}</ActionError> : null}
    </>
  );
}
