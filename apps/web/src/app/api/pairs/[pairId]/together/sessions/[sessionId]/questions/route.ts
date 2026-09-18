import { db, getTogetherQuestionPageForParticipant } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/server/http/together-http";

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

  const url = new URL(request.url);
  const band = url.searchParams.get("band");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!band)
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers: togetherNoStoreHeaders },
    );

  const { pairId, sessionId } = await context.params;
  try {
    return Response.json(
      await getTogetherQuestionPageForParticipant(db, {
        participantId: participant.id,
        pairId,
        sessionId,
        band,
        cursor,
      }),
      { headers: togetherNoStoreHeaders },
    );
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
