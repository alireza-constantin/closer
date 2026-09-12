import { createPairForParticipant, db, getParticipantByAuthUserId } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

function domainErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to create the pair.";
  const status = ["INTENDED_PERSON_NAME_INVALID", "RELATIONSHIP_TYPE_INVALID", "PAIR_CREATION_REQUEST_INVALID"].includes(message) ? 400 : message === "PARTICIPANT_NOT_FOUND" ? 409 : 500;
  return Response.json({ error: status === 400 ? message : "Unable to create the pair." }, { status });
}

export async function POST(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { intendedPersonName, relationshipType, clientRequestId } = body as Record<string, unknown>;
  if (typeof intendedPersonName !== "string" || typeof relationshipType !== "string" || (clientRequestId !== undefined && typeof clientRequestId !== "string")) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const resolvedParticipant = await getParticipantByAuthUserId(db, authUserId);
    if (!resolvedParticipant) return Response.json({ error: "Complete onboarding first." }, { status: 409 });
    const result = await createPairForParticipant(db, {
      participantId: resolvedParticipant.id,
      intendedPersonName,
      relationshipType,
      clientRequestId,
    });
    return Response.json({ pairId: result.pair.id, intendedPersonName: result.pair.intendedPersonName });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
