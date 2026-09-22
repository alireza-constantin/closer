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
