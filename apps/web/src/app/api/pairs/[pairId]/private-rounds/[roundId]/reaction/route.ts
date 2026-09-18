import { db, publishRealtimeEvent, removePrivateReaction, setPrivateReaction } from "@Closer/auth/closer";

import { privateDomainErrorResponse, requireRequestParticipant, noStoreHeaders } from "@/lib/private-api";

export async function PUT(request: Request, context: { params: Promise<{ pairId: string; roundId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const body: unknown = await request.json().catch(() => null);
  const value = body && typeof body === "object" && "value" in body ? body.value : null;
  if (typeof value !== "string") return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  const { pairId, roundId } = await context.params;
  try {
    const result = await setPrivateReaction(db, { participantId: participant.id, pairId, roundId, value });
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
    const result = await removePrivateReaction(db, { participantId: participant.id, pairId, roundId });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(result, {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
