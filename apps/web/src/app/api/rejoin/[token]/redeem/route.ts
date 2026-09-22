import { db, publishRealtimeEvent, restoreRejoinInvite } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/server/auth/current-participant";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  await request.json().catch(() => null);

  const { token } = await context.params;
  try {
    const result = await restoreRejoinInvite(db, { token, authUserId });
    await publishRealtimeEvent(result.pairId, "pair.changed");
    return Response.json(result);
  } catch {
    return Response.json({ error: "This rejoin link is unavailable." }, { status: 404 });
  }
}
