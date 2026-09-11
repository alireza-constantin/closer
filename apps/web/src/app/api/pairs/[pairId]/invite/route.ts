import { db, getParticipantByAuthUserId, issueInitialInvite, revokeInitialInvites } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    const invite = await issueInitialInvite(db, { participantId: participant.id, pairId });
    return Response.json({ token: invite.token, expiresAt: invite.expiresAt.toISOString() });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    await revokeInitialInvites(db, { participantId: participant.id, pairId });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}
