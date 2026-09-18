import { db, publishRealtimeEvent, removePrivateReply, setPrivateReply } from "@Closer/auth/closer";

import { privateDomainErrorResponse, requireRequestParticipant, noStoreHeaders } from "@/lib/private-api";

export async function PUT(request: Request, context: { params: Promise<{ pairId: string; roundId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const body: unknown = await request.json().catch(() => null);
  const reply = body && typeof body === "object" && "body" in body ? body.body : null;
  if (typeof reply !== "string") return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  const { pairId, roundId } = await context.params;
  try {
    const result = await setPrivateReply(db, { participantId: participant.id, pairId, roundId, body: reply });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(
      result,
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ pairId: string; roundId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId, roundId } = await context.params;
  try {
    const result = await removePrivateReply(db, { participantId: participant.id, pairId, roundId });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(result, {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
