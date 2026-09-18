import { db, getPrivateRoundForParticipant } from "@Closer/auth/closer";

import {
  hideUnviewedReveal,
  privateDomainErrorResponse,
  requireRequestParticipant,
  noStoreHeaders,
} from "@/server/http/private-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ pairId: string; roundId: string }> },
) {
  const participant = await requireRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );
  const { pairId, roundId } = await context.params;
  try {
    return Response.json(
      hideUnviewedReveal(
        await getPrivateRoundForParticipant(db, { participantId: participant.id, pairId, roundId }),
      ),
      {
        headers: noStoreHeaders,
      },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
