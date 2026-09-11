import { db, getPairStatusForParticipant, getParticipantByAuthUserId } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return json({ error: "Sign in is required." }, 401);

  const participant = await getParticipantByAuthUserId(db, authUserId);
  if (!participant) return json({ error: "Not found." }, 404);

  const { pairId } = await context.params;
  try {
    return json(await getPairStatusForParticipant(db, participant.id, pairId));
  } catch {
    return json({ error: "Not found." }, 404);
  }
}
