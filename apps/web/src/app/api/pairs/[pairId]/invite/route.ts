import { db, getParticipantByAuthUserId, isInitialInviteUsable, issueInitialInvite, revokeInitialInvites } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";
import { clearInitialInviteCookie, getInitialInviteCookie, setInitialInviteCookie } from "@/lib/initial-invite-cookie";

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    const token = getInitialInviteCookie(request, pairId);
    if (!token || !(await isInitialInviteUsable(db, { participantId: participant.id, pairId, token }))) {
      return Response.json({ error: "No reusable invite." }, { status: 404 });
    }

    return Response.json({ token });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    const invite = await issueInitialInvite(db, { participantId: participant.id, pairId });
    const headers = new Headers({ "content-type": "application/json" });
    setInitialInviteCookie(headers, pairId, invite.token, invite.expiresAt);
    return new Response(JSON.stringify({ token: invite.token, expiresAt: invite.expiresAt.toISOString() }), { headers });
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
    const headers = new Headers();
    clearInitialInviteCookie(headers, pairId);
    return new Response(null, { headers, status: 204 });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}
