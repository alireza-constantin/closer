import { CloserDomainError, db, getParticipantByAuthUserId } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function requireRequestParticipant(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return null;
  return getParticipantByAuthUserId(db, authUserId);
}

export function privateDomainErrorResponse(error: unknown) {
  if (error instanceof CloserDomainError) {
    if (["ANSWER_INVALID", "REPLY_INVALID", "REACTION_INVALID", "QUESTION_UNAVAILABLE"].includes(error.code)) {
      return Response.json({ error: error.code }, { status: 400, headers: noStoreHeaders });
    }
    if (error.code === "ANSWER_IMMUTABLE") {
      return Response.json({ error: error.code }, { status: 409, headers: noStoreHeaders });
    }
  }
  // Private resource authorization intentionally collapses to Not found.
  return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });
}

export function hideUnviewedReveal<T extends { state: string }>(view: T) {
  if (view.state !== "REVEAL_READY") return view;
  const { answers: _answers, reactions: _reactions, replies: _replies, ...safeView } = view as T & {
    answers?: unknown;
    reactions?: unknown;
    replies?: unknown;
  };
  return safeView;
}
