import { db, getPrivateConversationForParticipant } from "@Closer/auth/closer";

import { noStoreHeaders, privateDomainErrorResponse, requireRequestParticipant } from "@/lib/private-api";

export async function GET(request: Request, context: { params: Promise<{ pairId: string; conversationId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId, conversationId } = await context.params;
  try {
    return Response.json(await getPrivateConversationForParticipant(db, {
      participantId: participant.id,
      pairId,
      conversationId,
    }), { headers: noStoreHeaders });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
