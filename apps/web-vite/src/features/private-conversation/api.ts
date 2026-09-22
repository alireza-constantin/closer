import { z } from "zod";

import { requestJson } from "@/lib/api-client";

const candidateSchema = z.object({
  id: z.string(),
  liked: z.boolean(),
  question: z.object({
    id: z.string(),
    questionRevisionId: z.string(),
    text: z.string(),
    category: z.string(),
    intensity: z.enum(["light", "medium", "deep"]),
  }),
});

const roundSchema = z.object({
  roundId: z.string(),
  conversationId: z.string(),
  questionId: z.string(),
  questionRevisionId: z.string(),
  roundNumber: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  askedAt: z.string(),
  question: z.object({
    text: z.string(),
    category: z.string(),
    intensity: z.enum(["light", "medium", "deep"]),
  }),
});

export const privateConversationSchema = z.object({
  pairId: z.string(),
  conversationId: z.string(),
  category: z.string(),
  state: z.enum(["CANDIDATE", "WAITING_FOR_CREATOR", "CURRENT_ROUND", "EXHAUSTED"]),
  creatorDisplayName: z.string().optional(),
  candidate: candidateSchema.optional(),
  round: roundSchema.optional(),
});
export type PrivateConversation = z.infer<typeof privateConversationSchema>;
export type PrivateRound = z.infer<typeof roundSchema>;

export const privateCategories = ["fun", "deep", "memories", "relationship", "friendship"] as const;
export type PrivateCategory = (typeof privateCategories)[number];

export async function startPrivateConversation(pairId: string, category: string) {
  return privateConversationSchema.parse(
    await requestJson(`/pairs/${encodeURIComponent(pairId)}/private-conversations`, {
      method: "POST",
      body: { category },
    }),
  );
}

export async function getPrivateConversation(pairId: string, conversationId: string) {
  return privateConversationSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-conversations/${encodeURIComponent(conversationId)}`,
    ),
  );
}

export async function askPrivateCandidate(
  pairId: string,
  conversationId: string,
  candidateId: string,
  clientRequestId: string,
) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-conversations/${encodeURIComponent(conversationId)}/candidates/${encodeURIComponent(candidateId)}/select`,
      { method: "POST", body: { clientRequestId } },
    ),
  );
}

export async function skipPrivateCandidate(
  pairId: string,
  conversationId: string,
  candidateId: string,
  clientRequestId: string,
) {
  return privateConversationSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-conversations/${encodeURIComponent(conversationId)}/candidates/${encodeURIComponent(candidateId)}/skip`,
      { method: "POST", body: { clientRequestId } },
    ),
  );
}

export async function likePrivateCandidate(
  pairId: string,
  conversationId: string,
  candidateId: string,
  liked: boolean,
) {
  return z
    .object({ liked: z.boolean() })
    .parse(
      await requestJson(
        `/pairs/${encodeURIComponent(pairId)}/private-conversations/${encodeURIComponent(conversationId)}/candidates/${encodeURIComponent(candidateId)}/like`,
        { method: "PUT", body: { liked } },
      ),
    );
}
