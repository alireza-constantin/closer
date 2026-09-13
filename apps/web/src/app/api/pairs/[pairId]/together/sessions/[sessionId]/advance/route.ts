import { advanceTogetherSession, db, getTogetherSessionForParticipant } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/lib/together-api";

export async function POST(request: Request, context: { params: Promise<{ pairId: string; sessionId: string }> }) {
  const participant = await requireTogetherRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: togetherNoStoreHeaders });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: togetherNoStoreHeaders });
  }
  const action = "action" in body ? body.action : null;
  const clientRequestId = "clientRequestId" in body ? body.clientRequestId : undefined;
  const currentQuestionId = "currentQuestionId" in body ? body.currentQuestionId : undefined;
  if ((action !== "next" && action !== "skip") || (clientRequestId !== undefined && typeof clientRequestId !== "string") || (currentQuestionId !== undefined && typeof currentQuestionId !== "string")) {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: togetherNoStoreHeaders });
  }

  const { pairId, sessionId } = await context.params;
  try {
    await advanceTogetherSession(db, { participantId: participant.id, pairId, sessionId, action, clientRequestId, currentQuestionId });
    return Response.json(
      await getTogetherSessionForParticipant(db, { participantId: participant.id, pairId, sessionId }),
      { headers: togetherNoStoreHeaders },
    );
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
