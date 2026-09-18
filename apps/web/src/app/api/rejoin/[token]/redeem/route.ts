import {
  CloserDomainError,
  db,
  publishRealtimeEvent,
  redeemRejoinInvite,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const displayName =
    body && typeof body === "object" ? (body as Record<string, unknown>).displayName : null;
  if (typeof displayName !== "string")
    return Response.json({ error: "Invalid request." }, { status: 400 });

  const { token } = await context.params;
  try {
    const result = await redeemRejoinInvite(db, { token, authUserId, displayName });
    await publishRealtimeEvent(result.pairId, "pair.changed");
    return Response.json(result);
  } catch (error) {
    if (error instanceof CloserDomainError && error.code === "DISPLAY_NAME_INVALID") {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "This rejoin link is unavailable." }, { status: 404 });
  }
}
