import {
  db,
  getInitialInviteStatus,
  getParticipantByAuthUserId,
  isInitialInviteUsable,
  issueOrReuseInitialInvite,
  replaceInitialInvite,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/server/auth/current-participant";
import {
  getInitialInviteCookie,
  setInitialInviteCookie,
} from "@/features/invite/utils/initial-invite-cookie";

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    const token = getInitialInviteCookie(request, pairId);
    if (
      token &&
      (await isInitialInviteUsable(db, { participantId: participant.id, pairId, token }))
    ) {
      const status = await getInitialInviteStatus(db, { participantId: participant.id, pairId });
      if (status.state === "active") {
        return Response.json(
          { state: "local" as const, token, expiresAt: status.expiresAt.toISOString() },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
    }
    const status = await getInitialInviteStatus(db, { participantId: participant.id, pairId });
    return Response.json(
      status.state === "active"
        ? { state: "active" as const, expiresAt: status.expiresAt.toISOString() }
        : { state: "none" as const },
      { headers: { "Cache-Control": "private, no-store" } },
    );
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

    const invite = await issueOrReuseInitialInvite(db, { participantId: participant.id, pairId });
    if (invite.state === "active") {
      return Response.json(
        { state: "active" as const, expiresAt: invite.expiresAt.toISOString() },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const headers = new Headers({ "content-type": "application/json" });
    setInitialInviteCookie(headers, pairId, invite.token, invite.expiresAt);
    headers.set("Cache-Control", "private, no-store");
    return new Response(
      JSON.stringify({
        state: "local",
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      }),
      { headers },
    );
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { pairId } = await context.params;
  try {
    const participant = await getParticipantByAuthUserId(db, authUserId);
    if (!participant) return Response.json({ error: "Not found." }, { status: 404 });

    const invite = await replaceInitialInvite(db, { participantId: participant.id, pairId });
    const headers = new Headers({
      "content-type": "application/json",
      "Cache-Control": "private, no-store",
    });
    setInitialInviteCookie(headers, pairId, invite.token, invite.expiresAt);
    return new Response(
      JSON.stringify({
        state: "local",
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      }),
      { headers },
    );
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}
