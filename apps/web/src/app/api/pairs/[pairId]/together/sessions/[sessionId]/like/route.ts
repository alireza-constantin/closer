import { db, setTogetherSessionLike } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/lib/together-api";

export async function PUT(request: Request, context: { params: Promise<{ pairId: string; sessionId: string }> }) {
  const participant = await requireTogetherRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: togetherNoStoreHeaders });
  const body: unknown = await request.json().catch(() => null);
  const liked = body && typeof body === "object" && "liked" in body ? body.liked : null;
  if (typeof liked !== "boolean") {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: togetherNoStoreHeaders });
  }
  const { pairId, sessionId } = await context.params;
  try {
    return Response.json(
      await setTogetherSessionLike(db, { participantId: participant.id, pairId, sessionId, liked }),
      { headers: togetherNoStoreHeaders },
    );
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
