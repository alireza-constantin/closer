import { db, getParticipantByAuthUserId, updateIntendedPersonName } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).intendedPersonName !== "string"
  ) {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStoreHeaders });
  }

  const participant = await getParticipantByAuthUserId(db, authUserId);
  if (!participant)
    return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });

  try {
    const { pairId } = await context.params;
    const updated = await updateIntendedPersonName(db, {
      participantId: participant.id,
      pairId,
      intendedPersonName: (body as Record<string, string>).intendedPersonName,
    });
    return Response.json(
      { pairId: updated.id, intendedPersonName: updated.intendedPersonName },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "INTENDED_PERSON_NAME_INVALID" ? 400 : 404;
    return Response.json(
      { error: status === 400 ? message : "Not found." },
      { status, headers: noStoreHeaders },
    );
  }
}
