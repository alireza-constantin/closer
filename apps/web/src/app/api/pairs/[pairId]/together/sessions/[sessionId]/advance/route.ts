import { advanceTogetherSession, db } from "@Closer/auth/closer";

import {
  togetherDomainErrorResponse,
  togetherNoStoreHeaders,
  requireTogetherRequestParticipant,
} from "@/lib/together-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ pairId: string; sessionId: string }> },
) {
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
  const action = "action" in body ? body.action : null;
  const clientRequestId = "clientRequestId" in body ? body.clientRequestId : undefined;
  const currentQuestionId = "currentQuestionId" in body ? body.currentQuestionId : undefined;
  const nextQuestionId = "nextQuestionId" in body ? body.nextQuestionId : undefined;
  const nextQuestionRevisionId =
    "nextQuestionRevisionId" in body ? body.nextQuestionRevisionId : undefined;
  if (
    (action !== "next" && action !== "skip") ||
    (clientRequestId !== undefined && typeof clientRequestId !== "string") ||
    (currentQuestionId !== undefined && typeof currentQuestionId !== "string") ||
    (nextQuestionId !== undefined && typeof nextQuestionId !== "string") ||
    (nextQuestionRevisionId !== undefined && typeof nextQuestionRevisionId !== "string")
  ) {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers: togetherNoStoreHeaders },
    );
  }

  const { pairId, sessionId } = await context.params;
  try {
    const transition = await advanceTogetherSession(db, {
      participantId: participant.id,
      pairId,
      sessionId,
      action,
      clientRequestId,
      currentQuestionId,
      nextQuestionId,
      nextQuestionRevisionId,
    });
    return Response.json(transition, { headers: togetherNoStoreHeaders });
  } catch (error) {
    return togetherDomainErrorResponse(error);
  }
}
