import {
  CloserDomainError,
  db,
  getParticipantByAuthUserId,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export const togetherNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function requireTogetherRequestParticipant(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return null;
  return getParticipantByAuthUserId(db, authUserId);
}

export function togetherDomainErrorResponse(error: unknown) {
  if (error instanceof CloserDomainError) {
    if (error.code === "QUESTION_UNAVAILABLE" || error.code === "TOGETHER_ACTION_INVALID") {
      return Response.json({ error: error.code }, { status: 400, headers: togetherNoStoreHeaders });
    }
    if (error.code === "TOGETHER_SESSION_ENDED" || error.code === "TOGETHER_SESSION_EXHAUSTED") {
      return Response.json({ error: error.code }, { status: 409, headers: togetherNoStoreHeaders });
    }
  }

  // Together resource authorization intentionally collapses to Not found.
  return Response.json({ error: "Not found." }, { status: 404, headers: togetherNoStoreHeaders });
}
