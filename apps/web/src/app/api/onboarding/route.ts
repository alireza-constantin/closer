import { db, resolveOrCreateParticipant } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

function domainErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to complete onboarding.";
  if (message === "DISPLAY_NAME_INVALID") {
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ error: "Unable to complete onboarding." }, { status: 500 });
}

export async function POST(request: Request) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).displayName !== "string"
  ) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const resolvedParticipant = await resolveOrCreateParticipant(db, {
      authUserId,
      displayName: (body as Record<string, unknown>).displayName as string,
    });

    return Response.json({
      participantId: resolvedParticipant.id,
      displayName: resolvedParticipant.displayName,
    });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
