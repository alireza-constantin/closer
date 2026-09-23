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
  answers: z
    .array(
      z.object({ participantId: z.string(), body: z.string(), isOwner: z.boolean().optional() }),
    )
    .optional(),
  reactions: z
    .array(
      z.object({
        participantId: z.string(),
        displayName: z.string(),
        value: z.enum(["heart", "laugh", "tender", "surprised"]),
        isOwner: z.boolean().optional(),
      }),
    )
    .optional(),
  replies: z
    .array(
      z.object({
        participantId: z.string(),
        displayName: z.string(),
        body: z.string(),
        isOwner: z.boolean(),
      }),
    )
    .optional(),
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
  availableCategories: z.array(z.string()).optional(),
  candidate: candidateSchema.optional(),
  round: roundSchema.optional(),
});

export const privateHistorySchema = z.object({
  rounds: z.array(
    z.object({
      roundNumber: z.number().int().positive(),
      askedAt: z.string(),
      question: z.object({ text: z.string(), category: z.string(), intensity: z.string() }),
      answers: z.array(z.object({ displayName: z.string(), body: z.string() })),
      reactions: z.array(z.object({ displayName: z.string(), value: z.string() })),
      replies: z.array(z.object({ displayName: z.string(), body: z.string() })),
    }),
  ),
  nextCursor: z.string().optional(),
});
export type PrivateHistory = z.infer<typeof privateHistorySchema>;
export type PrivateConversation = z.infer<typeof privateConversationSchema>;
export type PrivateRound = z.infer<typeof roundSchema>;

export async function getPrivateHistory(pairId: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return privateHistorySchema.parse(
    await requestJson(`/pairs/${encodeURIComponent(pairId)}/private-history${query}`),
  );
}

export const privateAnswerSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write an answer first.")
    .max(2000, "Keep your answer under 2,000 characters."),
});
export type PrivateAnswerValues = z.infer<typeof privateAnswerSchema>;

export const privateReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a short thought first.")
    .max(500, "Replies can be up to 500 characters."),
});
export type PrivateReplyValues = z.infer<typeof privateReplySchema>;
export const privateReactionValues = ["heart", "laugh", "tender", "surprised"] as const;
export type PrivateReactionValue = (typeof privateReactionValues)[number];

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

export async function setPrivateReaction(
  pairId: string,
  roundId: string,
  value: PrivateReactionValue,
) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/reaction`,
      { method: "PUT", body: { value } },
    ),
  );
}

export async function removePrivateReaction(pairId: string, roundId: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/reaction`,
      { method: "DELETE" },
    ),
  );
}

export async function setPrivateReply(pairId: string, roundId: string, body: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/reply`,
      { method: "PUT", body: { body } },
    ),
  );
}

export async function removePrivateReply(pairId: string, roundId: string) {
  return roundSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/reply`,
      { method: "DELETE" },
    ),
  );
}

export async function progressPrivateRound(
  pairId: string,
  roundId: string,
  action: "ask_another" | "something_else",
  category: string,
  clientRequestId: string,
) {
  return privateConversationSchema.parse(
    await requestJson(
      `/pairs/${encodeURIComponent(pairId)}/private-rounds/${encodeURIComponent(roundId)}/progress`,
      { method: "POST", body: { action, category, clientRequestId } },
    ),
  );
}
