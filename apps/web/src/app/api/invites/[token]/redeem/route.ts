import {
  CloserDomainError,
  db,
  getParticipantByAuthUserId,
  publishRealtimeEvent,
  redeemInitialInvite,
  resolveOrCreateParticipant,
} from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";
import { joinPairSchema } from "@/lib/validation";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const { token } = await context.params;
  try {
    let claimant = await getParticipantByAuthUserId(db, authUserId);
    if (!claimant) {
      const body: unknown = await request.json().catch(() => null);
      const parsed = joinPairSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "DISPLAY_NAME_INVALID" }, { status: 400 });
      // This is the same canonical onboarding command used by /api/onboarding.
      // It runs only at the explicit Join POST boundary; there is intentionally
      // no distributed transaction spanning it and the later claim command.
      claimant = await resolveOrCreateParticipant(db, {
        authUserId,
        displayName: parsed.data.displayName,
      });
    }
    const result = await redeemInitialInvite(db, { token, participantId: claimant.id });
    await publishRealtimeEvent(result.pairId, "pair.changed");
    return Response.json(result);
  } catch (error) {
    if (error instanceof CloserDomainError && error.code === "DISPLAY_NAME_INVALID") {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "This invitation is unavailable." }, { status: 404 });
  }
}
