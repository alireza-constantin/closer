import { z } from "zod";

import { requestJson } from "@/lib/api-client";

const actorSchema = z.object({
  authUserId: z.string(),
  kind: z.enum(["anonymous", "registered", "admin"]),
  participant: z.object({ participantId: z.string(), displayName: z.string() }).nullable(),
});
export const meSchema = z.object({ actor: actorSchema.nullable() });
export type Me = z.infer<typeof meSchema>;

export const spaceSchema = z.object({
  pairId: z.string(),
  relationshipType: z.enum(["partner", "friend"]),
  state: z.string(),
  otherParticipantDisplayName: z.string().nullable(),
  intendedPersonName: z.string().nullable(),
});
export type Space = z.infer<typeof spaceSchema>;

export const pairEntrySchema = z.object({
  pairId: z.string(),
  state: z.string(),
  relationshipType: z.string().optional(),
  intendedPersonName: z.string().nullable().optional(),
  members: z.array(z.object({ slot: z.string(), displayName: z.string() })).optional(),
});
export type PairEntry = z.infer<typeof pairEntrySchema>;

export const inviteSchema = z.object({
  inviterDisplayName: z.string(),
  relationshipType: z.string(),
  intendedPersonName: z.string(),
  claimantDisplayName: z.string().nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const rejoinSchema = z.object({ targetSlot: z.string() });

export async function getMe() {
  return meSchema.parse(await requestJson("/me"));
}
export async function startAnonymous() {
  return requestJson("/auth/anonymous", { method: "POST", body: {} });
}
export async function logout() {
  return requestJson("/auth/logout", { method: "POST", body: {} });
}
export async function onboard(displayName: string) {
  return requestJson("/onboarding", { method: "POST", body: { displayName } });
}
export async function listSpaces() {
  const value = await requestJson<unknown>("/pairs");
  return z.array(spaceSchema).parse(value);
}
export async function createPair(input: {
  intendedPersonName: string;
  relationshipType: "partner" | "friend";
}) {
  return requestJson("/pairs", {
    method: "POST",
    body: { ...input, clientRequestId: crypto.randomUUID() },
  });
}
export async function getPair(pairId: string) {
  return pairEntrySchema.parse(await requestJson(`/pairs/${encodeURIComponent(pairId)}`));
}
export const inviteStateSchema = z.object({
  state: z.string(),
  token: z.string().optional(),
  expiresAt: z.string().optional(),
});
export async function getInviteState(pairId: string) {
  return inviteStateSchema.parse(await requestJson(`/pairs/${encodeURIComponent(pairId)}/invite`));
}
export async function issueInvite(pairId: string) {
  return inviteStateSchema.parse(
    await requestJson(`/pairs/${encodeURIComponent(pairId)}/invite`, { method: "POST", body: {} }),
  );
}
export async function previewInvite(token: string) {
  return inviteSchema.parse(await requestJson(`/invites/${encodeURIComponent(token)}`));
}
export async function redeemInvite(token: string, displayName?: string) {
  return requestJson(`/invites/${encodeURIComponent(token)}/redeem`, {
    method: "POST",
    body: displayName === undefined ? {} : { displayName },
  });
}
export async function previewRejoin(token: string) {
  return rejoinSchema.parse(await requestJson(`/rejoin/${encodeURIComponent(token)}`));
}
export async function redeemRejoin(token: string, displayName: string) {
  return requestJson(`/rejoin/${encodeURIComponent(token)}/redeem`, {
    method: "POST",
    body: { displayName },
  });
}

const togetherQuestionSchema = z.object({
  questionId: z.string(),
  questionRevisionId: z.string(),
  text: z.string(),
  intensity: z.string().optional(),
  position: z.number().optional(),
  liked: z.boolean().optional(),
});
const togetherPageSchema = z.object({
  items: z.array(togetherQuestionSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean(),
});
export const togetherPlaybackSchema = z.object({
  id: z.string(),
  pairId: z.string(),
  relationshipType: z.string(),
  category: z.string(),
  startedByParticipantId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  exhausted: z.boolean(),
  completedNextTransitions: z.number(),
  question: togetherQuestionSchema.nullable(),
  pages: z.object({
    light: togetherPageSchema,
    medium: togetherPageSchema,
    deep: togetherPageSchema,
  }),
});
export type TogetherPlayback = z.infer<typeof togetherPlaybackSchema>;
export const togetherAdvanceSchema = z.object({
  kind: z.enum(["QUESTION", "EXHAUSTED"]),
  sessionId: z.string(),
  questionId: z.string().optional(),
  questionRevisionId: z.string().optional(),
  position: z.number().optional(),
  completedNextTransitions: z.number(),
});

function togetherPath(pairId: string, suffix = "") {
  return `/pairs/${encodeURIComponent(pairId)}/together/sessions${suffix}`;
}

export async function startTogetherSession(pairId: string, category: string) {
  return z
    .object({ sessionId: z.string(), questionId: z.string(), questionRevisionId: z.string() })
    .parse(
      await requestJson(togetherPath(pairId), {
        method: "POST",
        body: { category, clientRequestId: crypto.randomUUID() },
      }),
    );
}

export async function getTogetherPlayback(pairId: string, sessionId: string) {
  return togetherPlaybackSchema.parse(
    await requestJson(togetherPath(pairId, `/${encodeURIComponent(sessionId)}`)),
  );
}

export async function getTogetherQuestionPage(
  pairId: string,
  sessionId: string,
  band: string,
  cursor?: string,
) {
  const params = new URLSearchParams({ band });
  if (cursor) params.set("cursor", cursor);
  return togetherPageSchema.parse(
    await requestJson(
      togetherPath(pairId, `/${encodeURIComponent(sessionId)}/questions?${params}`),
    ),
  );
}

export async function advanceTogetherSession(
  pairId: string,
  sessionId: string,
  action: "next" | "skip",
  currentQuestionId?: string,
) {
  return togetherAdvanceSchema.parse(
    await requestJson(togetherPath(pairId, `/${encodeURIComponent(sessionId)}/advance`), {
      method: "POST",
      body: { action, clientRequestId: crypto.randomUUID(), currentQuestionId },
    }),
  );
}

export async function likeTogetherQuestion(
  pairId: string,
  sessionId: string,
  liked: boolean,
  currentQuestionId?: string,
) {
  return togetherPlaybackSchema.parse(
    await requestJson(togetherPath(pairId, `/${encodeURIComponent(sessionId)}/like`), {
      method: "PUT",
      body: { liked, currentQuestionId },
    }),
  );
}

export async function endTogetherSession(pairId: string, sessionId: string) {
  return togetherPlaybackSchema.parse(
    await requestJson(togetherPath(pairId, `/${encodeURIComponent(sessionId)}/end`), {
      method: "POST",
      body: {},
    }),
  );
}
