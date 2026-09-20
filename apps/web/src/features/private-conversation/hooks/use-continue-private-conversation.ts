"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { closerKeys } from "@/lib/query/closer-query-keys";

type ContinuedConversation = {
  id: string;
  pairId: string;
  category: string;
  state: string;
};

function parseContinuedConversation(value: unknown): ContinuedConversation | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("pairId" in value) ||
    typeof value.pairId !== "string" ||
    !("category" in value) ||
    typeof value.category !== "string" ||
    !("state" in value) ||
    typeof value.state !== "string"
  )
    return null;
  return value as ContinuedConversation;
}

export function useContinuePrivateConversation({
  pairId,
  conversationId,
  category,
}: {
  pairId: string;
  conversationId: string;
  category: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isContinuing, setIsContinuing] = useState(false);

  async function continueConversation() {
    setIsContinuing(true);
    try {
      const response = await fetch(
        `/api/pairs/${encodeURIComponent(pairId)}/private-conversations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category, clientRequestId: crypto.randomUUID() }),
        },
      );
      const next = parseContinuedConversation(await response.json());
      if (
        !response.ok ||
        !next ||
        next.id !== conversationId ||
        next.pairId !== pairId ||
        next.category !== category
      )
        throw new Error("Unable to continue Private conversation.");

      queryClient.setQueryData(closerKeys.privateConversation(pairId, conversationId), next);
      await queryClient.invalidateQueries({
        queryKey: closerKeys.privateConversations(pairId),
      });
      router.push(`/pair/${pairId}/private/conversation/${conversationId}` as never);
      return true;
    } catch {
      return false;
    } finally {
      setIsContinuing(false);
    }
  }

  return { continueConversation, isContinuing };
}
