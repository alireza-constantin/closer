import { askPrivateQuestionCandidate, db, publishRealtimeEvent } from "@Closer/auth/closer";

import {
  noStoreHeaders,
  privateDomainErrorResponse,
  requireRequestParticipant,
} from "@/lib/private-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ pairId: string; conversationId: string; candidateId: string }> },
) {
  const participant = await requireRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );
  const body: unknown = await request.json().catch(() => null);
  const clientRequestId =
    body && typeof body === "object" && "clientRequestId" in body
      ? body.clientRequestId
      : undefined;
  if (clientRequestId !== undefined && typeof clientRequestId !== "string") {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  }
  const { pairId, conversationId, candidateId } = await context.params;
  try {
    const result = await askPrivateQuestionCandidate(db, {
      participantId: participant.id,
      pairId,
      conversationId,
      candidateId,
      clientRequestId,
    });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(result, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
