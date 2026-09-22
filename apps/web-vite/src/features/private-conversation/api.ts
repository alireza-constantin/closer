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
  state: z.enum([
    "open",
    "closed",
    "YOUR_TURN",
    "WAITING",
    "REVEAL_READY",
    "REVEAL_VIEWED",
    "DECLINED",
    "RETIRED",
  ]),
  askedAt: z.string(),
  yourAnswer: z.string().nullable().optional(),
  hasOtherAnswer: z.boolean().optional(),
  revealViewedAt: z.string().nullable().optional(),
  otherRevealViewedAt: z.string().nullable().optional(),
  otherRevealViewed: z.boolean().optional(),
  canContinue: z.boolean().optional(),
  answers: z.array(z.object({ participantId: z.string(), body: z.string() })).optional(),
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

export const privateAnswerSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write an answer first.")
    .max(2000, "Keep your answer under 2,000 characters."),
});
export type PrivateAnswerValues = z.infer<typeof privateAnswerSchema>;

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

export async function getPrivateRound(pairId: string, roundId: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}`,
    ),
  );
}

export async function submitPrivateAnswer(pairId: string, roundId: string, body: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/answer`,
      { method: "POST", body: { body } },
    ),
  );
}

export async function declinePrivateRound(pairId: string, roundId: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/retire`,
      { method: "POST" },
    ),
  );
}

export async function revealPrivateRound(pairId: string, roundId: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/reveal`,
      { method: "POST" },
    ),
  );
}
