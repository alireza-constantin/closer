import { db, getTogetherSessionPlaybackForParticipant } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/lib/together-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ pairId: string; sessionId: string }> },
) {
  const participant = await requireTogetherRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: togetherNoStoreHeaders },
    );
  const { pairId, sessionId } = await context.params;
  try {
    return Response.json(
      await getTogetherSessionPlaybackForParticipant(db, {
        participantId: participant.id,
        pairId,
        sessionId,
      }),
      { headers: togetherNoStoreHeaders },
    );
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
