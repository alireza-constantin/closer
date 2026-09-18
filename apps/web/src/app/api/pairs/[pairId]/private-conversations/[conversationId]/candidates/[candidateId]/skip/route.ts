import { db, publishRealtimeEvent, skipPrivateQuestionCandidate } from "@Closer/auth/closer";

import { noStoreHeaders, privateDomainErrorResponse, requireRequestParticipant } from "@/lib/private-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ pairId: string; conversationId: string; candidateId: string }> },
) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId, conversationId, candidateId } = await context.params;
  try {
    const result = await skipPrivateQuestionCandidate(db, { participantId: participant.id, pairId, conversationId, candidateId });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(
      result,
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
