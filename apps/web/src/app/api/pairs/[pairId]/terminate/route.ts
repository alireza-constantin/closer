import {
  db,
  getParticipantByAuthUserId,
  publishRealtimeEvent,
  terminatePair,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId)
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: noStoreHeaders },
    );

  const participant = await getParticipantByAuthUserId(db, authUserId);
  if (!participant)
    return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });

  try {
    const { pairId } = await context.params;
    const result = await terminatePair(db, { pairId, participantId: participant.id });
    await publishRealtimeEvent(pairId, "pair.terminated");
    return Response.json(
      {
        pairId: result.pairId,
        state: result.state,
        terminatedAt: result.terminatedAt.toISOString(),
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders });
  }
}
