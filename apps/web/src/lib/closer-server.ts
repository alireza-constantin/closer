import { auth } from "@Closer/auth";
import { db, getParticipantByAuthUserId } from "@Closer/auth/closer";
import { headers } from "next/headers";

export async function getAuthUserIdFromRequest(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) return null;
  return session.user.id;
}

export async function getCurrentAuthUserId() {
  return getAuthUserIdFromRequest(await headers());
}

export async function getCurrentParticipant() {
  const authUserId = await getCurrentAuthUserId();
  if (!authUserId) return null;
  return getParticipantByAuthUserId(db, authUserId);
}
