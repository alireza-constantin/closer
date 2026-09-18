import { db, publishRealtimeEvent, startTogetherSession } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/lib/together-api";

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await requireTogetherRequestParticipant(request);
  if (!participant)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: togetherNoStoreHeaders },
    );

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers: togetherNoStoreHeaders },
    );
  }
  const category = "category" in body ? body.category : null;
  const clientRequestId = "clientRequestId" in body ? body.clientRequestId : undefined;
  if (
    typeof category !== "string" ||
    (clientRequestId !== undefined && typeof clientRequestId !== "string")
  ) {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers: togetherNoStoreHeaders },
    );
  }

  const { pairId } = await context.params;
  try {
    const result = await startTogetherSession(db, {
      participantId: participant.id,
      pairId,
      category,
      clientRequestId,
    });
    await publishRealtimeEvent(pairId, "together.changed");
    return Response.json(result, { status: 201, headers: togetherNoStoreHeaders });
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
