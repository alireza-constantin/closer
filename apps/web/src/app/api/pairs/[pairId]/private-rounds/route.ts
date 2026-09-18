import { db, listActivePrivateConversations } from "@Closer/auth/closer";

import {
  privateDomainErrorResponse,
  requireRequestParticipant,
  noStoreHeaders,
} from "@/lib/private-api";

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );
  const { pairId } = await context.params;
  try {
    return Response.json(
      await listActivePrivateConversations(db, { participantId: participant.id, pairId }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
