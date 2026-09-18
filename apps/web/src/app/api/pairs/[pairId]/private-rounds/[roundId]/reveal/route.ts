import { db, markPrivateRevealViewed, publishRealtimeEvent } from "@Closer/auth/closer";

import {
  privateDomainErrorResponse,
  requireRequestParticipant,
  noStoreHeaders,
} from "@/lib/private-api";

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
  const { pairId, roundId } = await context.params;
  try {
    const result = await markPrivateRevealViewed(db, {
      participantId: participant.id,
      pairId,
      roundId,
    });
    await publishRealtimeEvent(pairId, "private.changed");
    return Response.json(result, {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
