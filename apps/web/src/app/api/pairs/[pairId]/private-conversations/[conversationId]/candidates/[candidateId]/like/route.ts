import { db, setPrivateQuestionCandidateLike } from "@Closer/auth/closer";

import {
  noStoreHeaders,
  privateDomainErrorResponse,
  requireRequestParticipant,
} from "@/server/http/private-http";

export async function PUT(
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
  const liked = body && typeof body === "object" && "liked" in body ? body.liked : undefined;
  if (typeof liked !== "boolean")
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  const { pairId, conversationId, candidateId } = await context.params;
  try {
    return Response.json(
      await setPrivateQuestionCandidateLike(db, {
        participantId: participant.id,
        pairId,
        conversationId,
        candidateId,
        liked,
      }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
