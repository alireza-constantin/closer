import { db, createPrivateRound, listActivePrivateConversations } from "@Closer/auth/closer";

import { privateDomainErrorResponse, requireRequestParticipant, noStoreHeaders } from "@/lib/private-api";

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const { pairId } = await context.params;
  try {
    return Response.json(await listActivePrivateConversations(db, { participantId: participant.id, pairId }), { headers: noStoreHeaders });
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const participant = await requireRequestParticipant(request);
  if (!participant) return Response.json({ error: "Sign in is required." }, { status: 401, headers: noStoreHeaders });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  const questionId = "questionId" in body ? body.questionId : null;
  const clientRequestId = "clientRequestId" in body ? body.clientRequestId : undefined;
  if (typeof questionId !== "string" || (clientRequestId !== undefined && typeof clientRequestId !== "string")) {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  }
  const { pairId } = await context.params;
  try {
    return Response.json(
      await createPrivateRound(db, { participantId: participant.id, pairId, questionId, clientRequestId }),
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
