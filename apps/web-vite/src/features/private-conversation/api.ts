import { z } from "zod";

import { requestJson } from "@/lib/api-client";

const candidateSchema = z.object({
  id: z.string(),
  question: z.object({
    id: z.string(),
    questionRevisionId: z.string(),
    text: z.string(),
    category: z.string(),
    intensity: z.enum(["light", "medium", "deep"]),
  }),
});

export const privateConversationSchema = z.object({
  pairId: z.string(),
  conversationId: z.string(),
  category: z.string(),
  state: z.enum(["CANDIDATE", "WAITING_FOR_CREATOR", "EXHAUSTED"]),
  creatorDisplayName: z.string().optional(),
  candidate: candidateSchema.optional(),
});
export type PrivateConversation = z.infer<typeof privateConversationSchema>;

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
