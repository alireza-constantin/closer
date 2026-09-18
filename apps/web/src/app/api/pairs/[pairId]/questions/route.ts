import { db, listEligiblePrivateQuestions } from "@Closer/auth/closer";

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
  const category = new URL(request.url).searchParams.get("category");
  if (!category)
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  try {
    return Response.json(
      await listEligiblePrivateQuestions(db, { participantId: participant.id, pairId, category }),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return privateDomainErrorResponse(error);
  }
}
