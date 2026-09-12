import { CloserDomainError, db, getParticipantByAuthUserId, redeemInitialInvite } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { token } = await context.params;
  try {
    const claimant = await getParticipantByAuthUserId(db, authUserId);
    if (!claimant) return Response.json({ error: "Complete onboarding before joining." }, { status: 409 });
    const result = await redeemInitialInvite(db, { token, participantId: claimant.id });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: "This invitation is unavailable." }, { status: 404 });
  }
}
