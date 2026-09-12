import { createPairForParticipant, db, resolveOrCreateParticipant } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";
import { setInitialInviteCookie } from "@/lib/initial-invite-cookie";

function domainErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to create the pair.";
  const status = message === "DISPLAY_NAME_INVALID" || message === "RELATIONSHIP_TYPE_INVALID" || message === "PAIR_CREATION_REQUEST_INVALID" ? 400 : 500;
  return Response.json({ error: status === 400 ? message : "Unable to create the pair." }, { status });
}

export async function POST(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { displayName, relationshipType, clientRequestId } = body as Record<string, unknown>;
  if (typeof displayName !== "string" || typeof relationshipType !== "string" || (clientRequestId !== undefined && typeof clientRequestId !== "string")) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const resolvedParticipant = await resolveOrCreateParticipant(db, { authUserId, displayName });
    const result = await createPairForParticipant(db, {
      participantId: resolvedParticipant.id,
      relationshipType,
      clientRequestId,
    });
    const headers = new Headers({ "content-type": "application/json" });
    setInitialInviteCookie(headers, result.pair.id, result.invite.token, result.invite.expiresAt);
    return new Response(JSON.stringify({
      pairId: result.pair.id,
      inviteToken: result.invite.token,
      expiresAt: result.invite.expiresAt.toISOString(),
    }), { headers });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
