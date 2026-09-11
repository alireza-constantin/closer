import {
  CloserDomainError,
  db,
  getParticipantByAuthUserId,
  issueRejoinInvite,
  revokeRejoinInvites,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function responseForDomainError(error: unknown) {
  if (error instanceof CloserDomainError && error.code === "REJOIN_UNAVAILABLE") {
    return Response.json({ error: error.code }, { status: 409, headers: noStoreHeaders });
  }
  return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });
}

async function getRequestParticipant(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return null;
  return getParticipantByAuthUserId(db, authUserId);
}

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await getRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId } = await context.params;
  try {
    const invite = await issueRejoinInvite(db, { participantId: participant.id, pairId });
    return Response.json(
      { token: invite.token, expiresAt: invite.expiresAt.toISOString(), targetParticipantDisplayName: invite.targetParticipantDisplayName },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return responseForDomainError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await getRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId } = await context.params;
  try {
    await revokeRejoinInvites(db, { participantId: participant.id, pairId });
    return new Response(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    return responseForDomainError(error);
  }
}
