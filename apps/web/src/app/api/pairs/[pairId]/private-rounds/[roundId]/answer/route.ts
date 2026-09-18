import { db, publishRealtimeEvent, submitPrivateAnswer } from "@Closer/auth/closer";

import {
  hideUnviewedReveal,
  privateDomainErrorResponse,
  requireRequestParticipant,
  noStoreHeaders,
} from "@/server/http/private-http";

export async function POST(
  request: Request,
  context: { params: Promise<{ pairId: string; roundId: string }> },
) {
  const participant = await requireRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );
  const body: unknown = await request.json().catch(() => null);
  const answer = body && typeof body === "object" && "body" in body ? body.body : null;
  if (typeof answer !== "string")
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  const { pairId, roundId } = await context.params;
  try {
    const result = await submitPrivateAnswer(db, {
      participantId: participant.id,
      pairId,
      roundId,
      body: answer,
    });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(hideUnviewedReveal(result), { headers: noStoreHeaders });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
